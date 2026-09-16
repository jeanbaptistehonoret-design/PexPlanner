import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

const DAYS_TO_SHOW = 90;
const STEP_MINUTES = 30;

function pad(n) {
  return String(n).padStart(2, "0");
}

function dateToString(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function timeToMinutes(time) {
  const [h, m] = String(time).substring(0, 5).split(":").map(Number);
  return h * 60 + m;
}

function minutesToTime(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${pad(h)}:${pad(m)}:00`;
}

function overlaps(startA, endA, startB, endB) {
  return startA < endB && endA > startB;
}

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
      .select("id, name, duration, active")
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
       3. PERIODE 90 JOURS
       ===================================================== */

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const endDate = new Date(today);
    endDate.setDate(endDate.getDate() + DAYS_TO_SHOW);

    const startDateString = dateToString(today);
    const endDateString = dateToString(endDate);


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
       5. BLOQUAGES
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
       6. CRENEAUX EXISTANTS
       ===================================================== */

    const {
      data: existingSlots,
      error: slotsError
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

    if (slotsError) {
      throw slotsError;
    }


    /* =====================================================
       7. RESERVATIONS EXISTANTES
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


    const bookedSlotIds = new Set(
      (bookings || []).map(
        booking => booking.slot_id
      )
    );


    /* =====================================================
       8. MAP DES CRENEAUX EXISTANTS
       ===================================================== */

    const existingSlotMap = new Map();

    (existingSlots || []).forEach(slot => {

      const key =
        `${slot.date}_${slot.time.substring(0, 5)}_${slot.session_id}`;

      existingSlotMap.set(key, slot);

    });


    /* =====================================================
       9. GENERATION
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


      /*
       Une exception remplace les horaires
       habituels pour cette date.
      */

      const exception =
        (specialHours || []).find(
          item =>
            item.date === dateString
        );


      let isOpen = false;
      let openingStart = null;
      let openingEnd = null;


      if (exception) {

        isOpen =
          exception.is_open === true;

        if (isOpen) {

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
          normalHours.is_open === true
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


      /*
       Jour fermé
      */

      if (
        !isOpen ||
        openingStart === null ||
        openingEnd === null
      ) {
        continue;
      }


      /* ===================================================
         10. CHAQUE PACK
         =================================================== */

      for (const session of sessions) {

        const duration =
          Number(session.duration);


        /*
         Départs toutes les 30 minutes.
        */

        for (
          let start = openingStart;
          start < openingEnd;
          start += STEP_MINUTES
        ) {

          const finish =
            start + duration;


          /*
           Le pack doit tenir entièrement
           dans les horaires.
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
           Si ce créneau existe déjà dans
           la base, on ne le recrée pas.
          */

          if (
            existingSlotMap.has(key)
          ) {
            continue;
          }


          /* ===============================================
             11. BLOCAGE MANUEL
             =============================================== */

          const blocked =
            (blockedPeriods || []).some(
              block => {

                if (
                  block.date !==
                  dateString
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


          slotsToCreate.push({

            date:
              dateString,

            time,

            session_id:
              session.id,

            status:
              blocked
                ? "unavailable"
                : "available",

            source:
              "pilotexperience",

            note:
              blocked
                ? "Bloqué"
                : null

          });

        }

      }

    }


    /* =====================================================
       12. CREER LES NOUVEAUX CRENEAUX
       ===================================================== */

    if (
      slotsToCreate.length > 0
    ) {

      /*
       On découpe éventuellement en lots
       pour éviter une requête trop importante.
      */

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

          /*
           Si un autre appel a créé
           les mêmes créneaux entre-temps,
           on continue.
          */

          console.error(
            "Erreur génération créneaux:",
            insertError
          );

        }

      }

    }


    /* =====================================================
       13. RELIRE LES CRENEAUX
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
      .gte("date", startDateString)
      .lte("date", endDateString)
      .order("date")
      .order("time");

    if (finalError) {
      throw finalError;
    }


    /* =====================================================
       14. RESERVATIONS = INDISPONIBLE
       ===================================================== */

    const result =
      (finalSlots || []).map(slot => {

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


    /* =====================================================
       15. REPONSE
       ===================================================== */

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
