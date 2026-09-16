import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

const DAYS_TO_SHOW = 90;
const STEP_MINUTES = 30;


/* =========================================================
   OUTILS
   ========================================================= */

function pad(n) {
  return String(n).padStart(2, "0");
}

function dateToString(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function timeToMinutes(time) {
  if (!time) return 0;

  const [hours, minutes] =
    String(time).substring(0, 5).split(":").map(Number);

  return hours * 60 + minutes;
}

function minutesToTime(minutes) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;

  return `${pad(hours)}:${pad(mins)}:00`;
}

function overlaps(startA, endA, startB, endB) {
  return startA < endB && endA > startB;
}


/* =========================================================
   API
   ========================================================= */

export default async function handler(req, res) {

  if (req.method !== "GET") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {

    /* =====================================================
       1. PACKS
       ===================================================== */

    const {
      data: sessions,
      error: sessionsError
    } = await supabase
      .from("sessions")
      .select(`
        id,
        name,
        duration,
        active
      `)
      .eq("active", true)
      .order("duration")
      .order("name");

    if (sessionsError) {
      throw sessionsError;
    }


    /* =====================================================
       2. HORAIRES HABITUELS
       ===================================================== */

    const {
      data: openingHours,
      error: openingError
    } = await supabase
      .from("opening_hours")
      .select("*");

    if (openingError) {
      throw openingError;
    }


    /* =====================================================
       3. DATES EXCEPTIONNELLES
       ===================================================== */

    const today = new Date();

    today.setHours(0, 0, 0, 0);

    const endDate = new Date(today);

    endDate.setDate(
      endDate.getDate() + DAYS_TO_SHOW
    );

    const startDateString =
      dateToString(today);

    const endDateString =
      dateToString(endDate);


    /* =====================================================
       4. OUVERTURES EXCEPTIONNELLES
       ===================================================== */

    const {
      data: specialHours,
      error: specialError
    } = await supabase
      .from("special_hours")
      .select("*")
      .gte("date", startDateString)
      .lte("date", endDateString);

    if (specialError) {
      throw specialError;
    }


    /* =====================================================
       5. BLOQUAGES EXCEPTIONNELS
       ===================================================== */

    const {
      data: blockedPeriods,
      error: blockedError
    } = await supabase
      .from("blocked_periods")
      .select("*")
      .gte("date", startDateString)
      .lte("date", endDateString);

    if (blockedError) {
      throw blockedError;
    }


    /* =====================================================
       6. CRENEAUX DEJA EXISTANTS
       ===================================================== */

    const {
      data: existingSlots,
      error: existingSlotsError
    } = await supabase
      .from("slots")
      .select(`
        id,
        date,
        time,
        status,
        source,
        note,
        session_id,
        sessions (
          id,
          name,
          duration
        )
      `)
      .gte("date", startDateString)
      .lte("date", endDateString);

    if (existingSlotsError) {
      throw existingSlotsError;
    }


    /* =====================================================
       7. RESERVATIONS
       ===================================================== */

    const {
      data: bookings,
      error: bookingsError
    } = await supabase
      .from("bookings")
      .select(`
        id,
        slot_id,
        source
      `);

    if (bookingsError) {
      throw bookingsError;
    }


    /* =====================================================
       8. IDENTIFIER LES CRENEAUX DEJA RESERVES
       ===================================================== */

    const bookedSlotIds = new Set(
      (bookings || []).map(
        booking => booking.slot_id
      )
    );


    /* =====================================================
       9. CONSTRUIRE UNE CARTE DES CRENEAUX EXISTANTS
       ===================================================== */

    const existingSlotMap = new Map();

    (existingSlots || []).forEach(slot => {

      const key =
        `${slot.date}_${slot.time.substring(0, 5)}_${slot.session_id}`;

      existingSlotMap.set(
        key,
        slot
      );

    });


    /* =====================================================
       10. CONSTRUIRE LES RESERVATIONS AVEC LEURS HORAIRES
       ===================================================== */

    const reservedPeriods = [];

    for (const booking of bookings || []) {

      const slot =
        (existingSlots || []).find(
          s => s.id === booking.slot_id
        );

      if (!slot || !slot.sessions) {
        continue;
      }

      const start =
        timeToMinutes(slot.time);

      const end =
        start + Number(
          slot.sessions.duration
        );

      reservedPeriods.push({
        date: slot.date,
        start,
        end
      });
    }


    /* =====================================================
       11. GENERATION
       ===================================================== */

    const slotsToCreate = [];


    for (
      let currentDate = new Date(today);
      currentDate <= endDate;
      currentDate.setDate(
        currentDate.getDate() + 1
      )
    ) {

      const dateString =
        dateToString(currentDate);

      const dayOfWeek =
        currentDate.getDay();


      /* ===================================================
         HORAIRES DU JOUR
         =================================================== */

      const exception =
        (specialHours || []).find(
          item =>
            item.date === dateString
        );


      let isOpen = false;
      let openingStart = null;
      let openingEnd = null;


      /*
       Une ouverture exceptionnelle remplace
       les horaires normaux de la journée.
      */

      if (exception) {

        if (
          exception.is_open === true &&
          exception.start_time &&
          exception.end_time
        ) {

          isOpen = true;

          openingStart =
            timeToMinutes(
              exception.start_time
            );

          openingEnd =
            timeToMinutes(
              exception.end_time
            );

        }

      } else {

        const normalHours =
          (openingHours || []).find(
            item =>
              item.day_of_week ===
              dayOfWeek
          );


        if (
          normalHours &&
          normalHours.is_open === true &&
          normalHours.start_time &&
          normalHours.end_time
        ) {

          isOpen = true;

          openingStart =
            timeToMinutes(
              normalHours.start_time
            );

          openingEnd =
            timeToMinutes(
              normalHours.end_time
            );

        }

      }


      if (
        !isOpen ||
        openingStart === null ||
        openingEnd === null
      ) {
        continue;
      }


      /* ===================================================
         12. GENERER CHAQUE PACK
         =================================================== */

      for (
        const session of sessions
      ) {

        const sessionDuration =
          Number(session.duration);


        for (
          let start = openingStart;
          start < openingEnd;
          start += STEP_MINUTES
        ) {

          const finish =
            start + sessionDuration;


          /*
           La séance doit tenir entièrement
           dans les horaires d'ouverture.
          */

          if (
            finish > openingEnd
          ) {
            continue;
          }


          const time =
            minutesToTime(start);


          const key =
            `${dateString}_${time.substring(0, 5)}_${session.id}`;


          /*
           Ce créneau existe déjà.
          */

          if (
            existingSlotMap.has(key)
          ) {
            continue;
          }


          /* =================================================
             13. BLOCAGE MANUEL
             ================================================= */

          const manuallyBlocked =
            (blockedPeriods || []).some(
              block => {

                if (
                  block.date !==
                  dateString
                ) {
                  return false;
                }


                if (
                  !block.start_time ||
                  !block.end_time
                ) {
                  return false;
                }


                const blockStart =
                  timeToMinutes(
                    block.start_time
                  );

                const blockEnd =
                  timeToMinutes(
                    block.end_time
                  );


                return overlaps(
                  start,
                  finish,
                  blockStart,
                  blockEnd
                );

              }
            );


          if (manuallyBlocked) {

            slotsToCreate.push({

              date:
                dateString,

              time,

              session_id:
                session.id,

              status:
                "unavailable",

              source:
                "pilotexperience",

              note:
                "Bloqué"

            });

            continue;
          }


          /* =================================================
             14. VERIFIER LES RESERVATIONS EXISTANTES
             ================================================= */

          const reservationConflict =
            reservedPeriods.some(
              reservation => {

                if (
                  reservation.date !==
                  dateString
                ) {
                  return false;
                }


                return overlaps(
                  start,
                  finish,
                  reservation.start,
                  reservation.end
                );

              }
            );


          /*
           IMPORTANT :

           On crée uniquement un créneau
           disponible s'il ne chevauche
           aucune réservation.
          */

          if (
            reservationConflict
          ) {

            slotsToCreate.push({

              date:
                dateString,

              time,

              session_id:
                session.id,

              status:
                "unavailable",

              source:
                "pilotexperience",

              note:
                "Indisponible — réservation existante"

            });

            continue;
          }


          /* =================================================
             15. CRENEAU DISPONIBLE
             ================================================= */

          slotsToCreate.push({

            date:
              dateString,

            time,

            session_id:
              session.id,

            status:
              "available",

            source:
              "pilotexperience",

            note:
              null

          });

        }

      }

    }


    /* =====================================================
       16. ENREGISTRER LES CRENEAUX
       ===================================================== */

    const BATCH_SIZE = 500;

    for (
      let i = 0;
      i < slotsToCreate.length;
      i += BATCH_SIZE
    ) {

      const batch =
        slotsToCreate.slice(
          i,
          i + BATCH_SIZE
        );


      const {
        error: insertError
      } = await supabase
        .from("slots")
        .insert(batch);


      if (insertError) {

        console.error(
          "Erreur génération créneaux :",
          insertError
        );

      }

    }


    /* =====================================================
       17. RELIRE LE PLANNING
       ===================================================== */

    const {
      data: finalSlots,
      error: finalError
    } = await supabase
      .from("slots")
      .select(`
        id,
        date,
        time,
        status,
        source,
        note,
        session_id,
        sessions (
          id,
          name,
          duration
        )
      `)
      .gte(
        "date",
        startDateString
      )
      .lte(
        "date",
        endDateString
      )
      .order("date")
      .order("time");


    if (finalError) {
      throw finalError;
    }


    /* =====================================================
       18. RENVOYER LES CRENEAUX
       ===================================================== */

    const result =
      (finalSlots || []).map(slot => {

        /*
         Une réservation rend son créneau
         indisponible dans le calendrier.
        */

        if (
          bookedSlotIds.has(
            slot.id
          )
        ) {

          return {
            ...slot,
            status:
              "unavailable"
          };

        }

        return slot;

      });


    return res.status(200).json(
      result
    );


  } catch (error) {

    console.error(error);

    return res.status(500).json({

      error:
        error.message ||
        "Erreur serveur"

    });

  }

}
