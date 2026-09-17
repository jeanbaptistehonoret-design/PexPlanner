import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

const DAYS_TO_SHOW = 90;
const STEP_MINUTES = 30;
const PAGE_SIZE = 1000;
const INSERT_BATCH_SIZE = 500;

/* =========================================================
   OUTILS
========================================================= */

function formatDateLocal(date) {
  return date.toISOString().split("T")[0];
}

function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function normalizeTime(time) {
  if (!time) return null;
  return String(time).slice(0, 5);
}

function timeToMinutes(time) {
  if (!time) return 0;

  const parts = String(time).split(":").map(Number);

  return parts[0] * 60 + parts[1];
}

function minutesToTime(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  return (
    String(hours).padStart(2, "0") +
    ":" +
    String(minutes).padStart(2, "0") +
    ":00"
  );
}

/*
  Récupère toutes les lignes par pages de 1000.
  Cela évite la limite de réponse de Supabase.
*/
async function fetchAllPages(buildQuery) {
  const rows = [];
  let from = 0;

  while (true) {
    const to = from + PAGE_SIZE - 1;

    const { data, error } = await buildQuery(from, to);

    if (error) {
      throw error;
    }

    if (!data || data.length === 0) {
      break;
    }

    rows.push(...data);

    if (data.length < PAGE_SIZE) {
      break;
    }

    from += PAGE_SIZE;
  }

  return rows;
}

/* =========================================================
   API
========================================================= */

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      error: "Méthode non autorisée",
    });
  }

  try {
    /* =====================================================
       1. DATES
    ===================================================== */

    const today = new Date();

    today.setHours(0, 0, 0, 0);

    const endDate = addDays(today, DAYS_TO_SHOW);

    const todayString = formatDateLocal(today);
    const endDateString = formatDateLocal(endDate);

    /* =====================================================
       2. SESSIONS
    ===================================================== */

    const {
      data: sessions,
      error: sessionsError,
    } = await supabase
      .from("sessions")
      .select("*")
      .eq("active", true)
      .order("name");

    if (sessionsError) {
      console.error(
        "Erreur sessions :",
        sessionsError
      );

      return res.status(500).json({
        error: "Erreur récupération sessions",
        details: sessionsError.message,
      });
    }

    /* =====================================================
       3. HORAIRES NORMAUX
    ===================================================== */

    const {
      data: openingHours,
      error: openingHoursError,
    } = await supabase
      .from("opening_hours")
      .select("*")
      .order("day_of_week");

    if (openingHoursError) {
      console.error(
        "Erreur horaires d'ouverture :",
        openingHoursError
      );

      return res.status(500).json({
        error: "Erreur récupération horaires",
        details: openingHoursError.message,
      });
    }

    /* =====================================================
       4. HORAIRES SPECIAUX
    ===================================================== */

    const {
      data: specialHours,
      error: specialHoursError,
    } = await supabase
      .from("special_hours")
      .select("*")
      .gte("date", todayString)
      .lte("date", endDateString)
      .order("date");

    if (specialHoursError) {
      console.error(
        "Erreur horaires spéciaux :",
        specialHoursError
      );

      return res.status(500).json({
        error: "Erreur récupération horaires spéciaux",
        details: specialHoursError.message,
      });
    }

    /* =====================================================
       5. PERIODES BLOQUEES
    ===================================================== */

    const {
      data: blockedPeriods,
      error: blockedPeriodsError,
    } = await supabase
      .from("blocked_periods")
      .select("*")
      .gte("date", todayString)
      .lte("date", endDateString)
      .order("date")
      .order("start_time");

    if (blockedPeriodsError) {
      console.error(
        "Erreur périodes bloquées :",
        blockedPeriodsError
      );

      return res.status(500).json({
        error: "Erreur récupération périodes bloquées",
        details: blockedPeriodsError.message,
      });
    }

    /* =====================================================
       6. CRENEAUX EXISTANTS
       PAGINATION COMPLETE
    ===================================================== */

    let existingSlots;

    try {
      existingSlots = await fetchAllPages(
        (from, to) =>
          supabase
            .from("slots")
            .select(`
              id,
              session_id,
              date,
              time,
              status,
              source,
              note,
              created_at
            `)
            .gte("date", todayString)
            .lte("date", endDateString)
            .order("date")
            .order("time")
            .range(from, to)
      );
    } catch (error) {
      console.error(
        "Erreur récupération créneaux existants :",
        error
      );

      return res.status(500).json({
        error: "Erreur récupération créneaux existants",
        details: error.message,
      });
    }

    /* =====================================================
       7. RESERVATIONS
       PAGINATION COMPLETE
    ===================================================== */

    let bookings;

    try {
      bookings = await fetchAllPages(
        (from, to) =>
          supabase
            .from("bookings")
            .select(`
              id,
              slot_id,
              first_name,
              last_name,
              email,
              phone,
              ticket,
              participants,
              comment,
              source,
              created_at,
              partner_name
            `)
            .range(from, to)
      );
    } catch (error) {
      console.error(
        "Erreur récupération réservations :",
        error
      );

      return res.status(500).json({
        error: "Erreur récupération réservations",
        details: error.message,
      });
    }

    /* =====================================================
       8. MAP CRENEAUX EXISTANTS
    ===================================================== */

    const existingSlotMap = new Map();

    for (const slot of existingSlots) {
      const key =
        `${slot.date}|${normalizeTime(slot.time)}|${slot.session_id}`;

      existingSlotMap.set(key, slot);
    }

    /* =====================================================
       9. CRENEAUX RESERVES
    ===================================================== */

    const reservedSlotIds = new Set();

    for (const booking of bookings) {
      if (booking.slot_id) {
        reservedSlotIds.add(booking.slot_id);
      }
    }

    /* =====================================================
       10. MAP HORAIRES SPECIAUX
    ===================================================== */

    const specialHoursMap = new Map();

    for (const special of specialHours || []) {
      specialHoursMap.set(special.date, special);
    }

    /* =====================================================
       11. MAP HORAIRES NORMAUX
    ===================================================== */

    const openingHoursMap = new Map();

    for (const opening of openingHours || []) {
      openingHoursMap.set(
        opening.day_of_week,
        opening
      );
    }

    /* =====================================================
       12. MAP PERIODES BLOQUEES
    ===================================================== */

    const blockedPeriodsMap = new Map();

    for (const blocked of blockedPeriods || []) {
      if (!blockedPeriodsMap.has(blocked.date)) {
        blockedPeriodsMap.set(blocked.date, []);
      }

      blockedPeriodsMap
        .get(blocked.date)
        .push(blocked);
    }

    /* =====================================================
       13. GENERATION DES CRENEAUX
    ===================================================== */

    const slotsToCreate = [];

    let currentDate = new Date(today);

    while (currentDate <= endDate) {
      const dateString = formatDateLocal(currentDate);

      /*
        JavaScript :
        0 = dimanche
        1 = lundi
        2 = mardi
        3 = mercredi
        4 = jeudi
        5 = vendredi
        6 = samedi
      */

      const dayOfWeek = currentDate.getDay();

      let isOpen = false;
      let startTime = null;
      let endTime = null;

      /* ===================================================
         HORAIRES SPECIAUX PRIORITAIRES
      =================================================== */

      const special = specialHoursMap.get(dateString);

      if (special) {
        isOpen = special.is_open;

        if (special.is_open) {
          startTime = normalizeTime(
            special.start_time
          );

          endTime = normalizeTime(
            special.end_time
          );
        }
      } else {
        /* =================================================
           HORAIRES NORMAUX
        ================================================= */

        const normalHours =
          openingHoursMap.get(dayOfWeek);

        if (normalHours) {
          isOpen = normalHours.is_open;

          if (normalHours.is_open) {
            startTime = normalizeTime(
              normalHours.start_time
            );

            endTime = normalizeTime(
              normalHours.end_time
            );
          }
        }
      }

      /* ===================================================
         JOUR FERME
      =================================================== */

      if (
        !isOpen ||
        !startTime ||
        !endTime
      ) {
        currentDate = addDays(currentDate, 1);
        continue;
      }

      /* ===================================================
         PLAGE HORAIRE
      =================================================== */

      const openingStart =
        timeToMinutes(startTime);

      const openingEnd =
        timeToMinutes(endTime);

      /* ===================================================
         BLOQUAGES
      =================================================== */

      const dayBlockedPeriods =
        blockedPeriodsMap.get(dateString) || [];

      /* ===================================================
         GENERATION PAR SESSION
      =================================================== */

      for (const session of sessions || []) {
        const duration =
          Number(session.duration || 0);

        if (duration <= 0) {
          continue;
        }

        for (
          let startMinutes = openingStart;
          startMinutes + duration <= openingEnd;
          startMinutes += STEP_MINUTES
        ) {
          const startTimeValue =
            minutesToTime(startMinutes);

          const endMinutes =
            startMinutes + duration;

          /* ===============================================
             VERIFIER SI BLOQUE
          =============================================== */

          let isBlocked = false;
          let blockReasons = [];

          for (
            const blocked of dayBlockedPeriods
          ) {
            const blockedStart =
              timeToMinutes(
                blocked.start_time
              );

            const blockedEnd =
              timeToMinutes(
                blocked.end_time
              );

            const overlaps =
              startMinutes < blockedEnd &&
              endMinutes > blockedStart;

            if (overlaps) {
              isBlocked = true;

              if (blocked.reason) {
                blockReasons.push(
                  blocked.reason
                );
              }
            }
          }

          /* ===============================================
             CLE
          =============================================== */

          const key =
            `${dateString}|${startTimeValue}|${session.id}`;

          /* ===============================================
             CRENEAU DEJA PRESENT
          =============================================== */

          if (existingSlotMap.has(key)) {
            continue;
          }

          /* ===============================================
             STATUT
          =============================================== */

          let status = "available";
          let note = null;

          if (isBlocked) {
            status = "blocked";

            note =
              blockReasons.length > 0
                ? blockReasons.join(" / ")
                : null;
          }

          /* ===============================================
             AJOUT
          =============================================== */

          slotsToCreate.push({
            session_id: session.id,
            date: dateString,
            time: startTimeValue,
            status,
            source: "auto",
            note,
          });
        }
      }

      currentDate = addDays(
        currentDate,
        1
      );
    }

    /* =====================================================
       14. DEDUPLICATION
    ===================================================== */

    const uniqueSlotsMap = new Map();

    for (const slot of slotsToCreate) {
      const key =
        `${slot.date}|${slot.time}|${slot.session_id}`;

      if (!uniqueSlotsMap.has(key)) {
        uniqueSlotsMap.set(key, slot);
      }
    }

    const uniqueSlots =
      Array.from(
        uniqueSlotsMap.values()
      );

    console.log(
      `Créneaux à créer : ${uniqueSlots.length}`
    );

    /* =====================================================
       15. INSERTION
    ===================================================== */

    for (
      let i = 0;
      i < uniqueSlots.length;
      i += INSERT_BATCH_SIZE
    ) {
      const batch =
        uniqueSlots.slice(
          i,
          i + INSERT_BATCH_SIZE
        );

      if (!batch.length) {
        continue;
      }

      const {
        error: insertError,
      } = await supabase
        .from("slots")
        .insert(batch);

      /* ===================================================
         SI LE LOT ECHOUE
         ON ESSAIE LIGNE PAR LIGNE
      =================================================== */

      if (insertError) {
        console.error(
          `Erreur insertion lot ${i} :`,
          insertError
        );

        for (const slot of batch) {
          const {
            error: singleInsertError,
          } = await supabase
            .from("slots")
            .insert(slot);

          if (singleInsertError) {
            /*
              23505 = violation de contrainte unique.
              Cela signifie généralement que le créneau
              existe déjà : on l'ignore.
            */

            if (
              singleInsertError.code === "23505"
            ) {
              continue;
            }

            console.error(
              "Erreur insertion créneau :",
              singleInsertError
            );
          }
        }
      }
    }

    /* =====================================================
       16. RELIRE TOUS LES CRENEAUX
       PAGINATION COMPLETE
    ===================================================== */

    let finalSlots;

    try {
      finalSlots = await fetchAllPages(
        (from, to) =>
          supabase
            .from("slots")
            .select(`
              id,
              session_id,
              date,
              time,
              status,
              source,
              note,
              created_at,
              sessions (
                id,
                name,
                duration,
                active
              )
            `)
            .gte("date", todayString)
            .lte("date", endDateString)
            .order("date")
            .order("time")
            .range(from, to)
      );
    } catch (error) {
      console.error(
        "Erreur récupération finale :",
        error
      );

      return res.status(500).json({
        error:
          "Erreur récupération finale des créneaux",
        details: error.message,
      });
    }

    /* =====================================================
       17. APPLIQUER LES RESERVATIONS
    ===================================================== */

    const output =
      finalSlots.map((slot) => {
        const isReserved =
          reservedSlotIds.has(slot.id);

        return {
          ...slot,

          status: isReserved
            ? "booked"
            : slot.status,
        };
      });

    /* =====================================================
       18. REPONSE
    ===================================================== */

    return res.status(200).json({
      success: true,

      from: todayString,

      to: endDateString,

      days: DAYS_TO_SHOW,

      total: output.length,

      slots: output,
    });

  } catch (error) {
    console.error(
      "Erreur API /api/slots :",
      error
    );

    return res.status(500).json({
      error: "Erreur serveur",

      details:
        error?.message ||
        "Erreur inconnue",
    });
  }
}
