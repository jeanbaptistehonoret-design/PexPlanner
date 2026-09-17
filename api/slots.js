import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

const DAYS_TO_SHOW = 90;
const STEP_MINUTES = 30;
const MAX_ROWS = 10000;

/* =========================================================
   OUTILS
========================================================= */

function formatDateLocal(date) {
  return date.toISOString().split("T")[0];
}

function timeToMinutes(time) {
  if (!time) return 0;

  const [hours, minutes] = String(time).split(":").map(Number);

  return hours * 60 + minutes;
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

function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function normalizeTime(time) {
  if (!time) return null;

  return String(time).slice(0, 5);
}

/* =========================================================
   GET /api/slots
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
       2. SESSIONS ACTIVES
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
      console.error("Erreur sessions :", sessionsError);

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
       IMPORTANT : > 1000 lignes
    ===================================================== */

    const {
      data: existingSlots,
      error: existingSlotsError,
    } = await supabase
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
      .range(0, MAX_ROWS - 1);

    if (existingSlotsError) {
      console.error(
        "Erreur récupération créneaux existants :",
        existingSlotsError
      );

      return res.status(500).json({
        error: "Erreur récupération créneaux existants",
        details: existingSlotsError.message,
      });
    }

    /* =====================================================
       7. RESERVATIONS
    ===================================================== */

    const {
      data: bookings,
      error: bookingsError,
    } = await supabase
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
      .range(0, MAX_ROWS - 1);

    if (bookingsError) {
      console.error(
        "Erreur récupération réservations :",
        bookingsError
      );

      return res.status(500).json({
        error: "Erreur récupération réservations",
        details: bookingsError.message,
      });
    }

    /* =====================================================
       8. MAP DES CRENEAUX EXISTANTS
    ===================================================== */

    const existingSlotMap = new Map();

    for (const slot of existingSlots || []) {
      const key =
        `${slot.date}|${normalizeTime(slot.time)}|${slot.session_id}`;

      existingSlotMap.set(key, slot);
    }

    /* =====================================================
       9. CRENEAUX RESERVES
    ===================================================== */

    const reservedSlotIds = new Set();

    for (const booking of bookings || []) {
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
      openingHoursMap.set(opening.day_of_week, opening);
    }

    /* =====================================================
       12. GROUPER LES BLOQUAGES PAR DATE
    ===================================================== */

    const blockedPeriodsMap = new Map();

    for (const blocked of blockedPeriods || []) {
      if (!blockedPeriodsMap.has(blocked.date)) {
        blockedPeriodsMap.set(blocked.date, []);
      }

      blockedPeriodsMap.get(blocked.date).push(blocked);
    }

    /* =====================================================
       13. GENERATION
    ===================================================== */

    const slotsToCreate = [];

    let currentDate = new Date(today);

    while (currentDate <= endDate) {
      const dateString = formatDateLocal(currentDate);

      /*
        JS :
        dimanche = 0
        lundi    = 1
        mardi    = 2
        mercredi = 3
        jeudi    = 4
        vendredi = 5
        samedi   = 6
      */

      const dayOfWeek = currentDate.getDay();

      /* ===================================================
         HORAIRES DU JOUR
      =================================================== */

      let isOpen = false;
      let startTime = null;
      let endTime = null;

      const special = specialHoursMap.get(dateString);

      if (special) {
        isOpen = special.is_open;

        if (special.is_open) {
          startTime = normalizeTime(special.start_time);
          endTime = normalizeTime(special.end_time);
        }
      } else {
        const normalHours = openingHoursMap.get(dayOfWeek);

        if (normalHours) {
          isOpen = normalHours.is_open;

          if (normalHours.is_open) {
            startTime = normalizeTime(normalHours.start_time);
            endTime = normalizeTime(normalHours.end_time);
          }
        }
      }

      /* ===================================================
         JOUR FERME
      =================================================== */

      if (!isOpen || !startTime || !endTime) {
        currentDate = addDays(currentDate, 1);
        continue;
      }

      /* ===================================================
         MINUTES OUVERTURE
      =================================================== */

      const openingStart = timeToMinutes(startTime);
      const openingEnd = timeToMinutes(endTime);

      /* ===================================================
         BLOQUAGES DU JOUR
      =================================================== */

      const dayBlockedPeriods =
        blockedPeriodsMap.get(dateString) || [];

      /* ===================================================
         GENERER CHAQUE SESSION
      =================================================== */

      for (const session of sessions || []) {
        const duration = Number(session.duration || 0);

        if (!duration) {
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
             VERIFICATION PERIODE BLOQUEE
          =============================================== */

          let isBlocked = false;

          for (const blocked of dayBlockedPeriods) {
            const blockedStart =
              timeToMinutes(blocked.start_time);

            const blockedEnd =
              timeToMinutes(blocked.end_time);

            const overlaps =
              startMinutes < blockedEnd &&
              endMinutes > blockedStart;

            if (overlaps) {
              isBlocked = true;
              break;
            }
          }

          /* ===============================================
             CLE UNIQUE
          =============================================== */

          const key =
            `${dateString}|${startTimeValue}|${session.id}`;

          const existingSlot =
            existingSlotMap.get(key);

          /* ===============================================
             CRENEAU EXISTANT
          =============================================== */

          if (existingSlot) {
            continue;
          }

          /* ===============================================
             STATUT INITIAL
          =============================================== */

          let status = "available";
          let note = null;

          if (isBlocked) {
            status = "blocked";
            note =
              dayBlockedPeriods
                .filter((blocked) => {
                  const blockedStart =
                    timeToMinutes(blocked.start_time);

                  const blockedEnd =
                    timeToMinutes(blocked.end_time);

                  return (
                    startMinutes < blockedEnd &&
                    endMinutes > blockedStart
                  );
                })
                .map((blocked) => blocked.reason)
                .filter(Boolean)
                .join(" / ");
          }

          /* ===============================================
             CREATION
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

      currentDate = addDays(currentDate, 1);
    }

    /* =====================================================
       14. DEDUPLICATION
       Sécurité supplémentaire
    ===================================================== */

    const uniqueSlotsMap = new Map();

    for (const slot of slotsToCreate) {
      const key =
        `${slot.date}|${slot.time}|${slot.session_id}`;

      if (!uniqueSlotsMap.has(key)) {
        uniqueSlotsMap.set(key, slot);
      }
    }

    const uniqueSlots = Array.from(
      uniqueSlotsMap.values()
    );

    /* =====================================================
       15. INSERTION PAR LOTS
    ===================================================== */

    for (
      let i = 0;
      i < uniqueSlots.length;
      i += 500
    ) {
      const batch =
        uniqueSlots.slice(i, i + 500);

      if (!batch.length) {
        continue;
      }

      const {
        error: insertError,
      } = await supabase
        .from("slots")
        .insert(batch);

      if (insertError) {
        console.error(
          "Erreur génération créneaux :",
          insertError
        );

        throw new Error(
          "Erreur génération créneaux : " +
          insertError.message
        );
      }
    }

    /* =====================================================
       16. RELIRE TOUS LES CRENEAUX
       IMPORTANT : > 1000 lignes
    ===================================================== */

    const {
      data: finalSlots,
      error: finalSlotsError,
    } = await supabase
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
      .range(0, MAX_ROWS - 1);

    if (finalSlotsError) {
      console.error(
        "Erreur récupération finale des créneaux :",
        finalSlotsError
      );

      return res.status(500).json({
        error: "Erreur récupération finale des créneaux",
        details: finalSlotsError.message,
      });
    }

    /* =====================================================
       17. AJOUTER L'ETAT RESERVE
    ===================================================== */

    const output = (finalSlots || []).map((slot) => {
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
