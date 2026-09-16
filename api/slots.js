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

function pad(number) {
  return String(number).padStart(2, "0");
}

function dateToString(date) {
  return (
    date.getFullYear() +
    "-" +
    pad(date.getMonth() + 1) +
    "-" +
    pad(date.getDate())
  );
}

function timeToMinutes(time) {
  const [hours, minutes] = time.substring(0, 5).split(":").map(Number);
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

    /*
     -------------------------------------------------------
     1. RECUPERER LES PACKS
     -------------------------------------------------------
    */

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


    /*
     -------------------------------------------------------
     2. HORAIRES HABITUELS
     -------------------------------------------------------
    */

    const {
      data: openingHours,
      error: openingError
    } = await supabase
      .from("opening_hours")
      .select("*");


    if (openingError) {
      throw openingError;
    }


    /*
     -------------------------------------------------------
     3. OUVERTURES / FERMETURES EXCEPTIONNELLES
     -------------------------------------------------------
    */

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


    const {
      data: specialHours,
      error: specialHoursError
    } = await supabase
      .from("special_hours")
      .select("*")
      .gte("date", startDateString)
      .lte("date", endDateString);


    if (specialHoursError) {
      throw specialHoursError;
    }


    /*
     -------------------------------------------------------
     4. BLOQUAGES MANUELS
     -------------------------------------------------------
    */

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


    /*
     -------------------------------------------------------
     5. CRENEAUX EXISTANTS
     -------------------------------------------------------
     
     On conserve les créneaux déjà créés dans la base :
     - réservés
     - partenaires
     - bloqués manuellement

     Ils ne doivent pas être recréés ou écrasés.
    */

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


    /*
     -------------------------------------------------------
     6. RESERVATIONS
     -------------------------------------------------------
    */

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


    const existingSlotMap = new Map();

    (existingSlots || []).forEach(slot => {

      const key =
        `${slot.date}_${slot.time.substring(0, 5)}_${slot.session_id}`;

      existingSlotMap.set(key, slot);

    });


    /*
     -------------------------------------------------------
     7. GENERATION AUTOMATIQUE
     -------------------------------------------------------
    */

    const slotsToCreate = [];


    for (
      let date = new Date(today);
      date <= endDate;
      date.setDate(date.getDate() + 1)
    ) {

      const dateString =
        dateToString(date);

      const dayOfWeek =
        date.getDay();


      /*
       Une date exceptionnelle remplace
       l'horaire habituel de ce jour.
      */

      const exception =
        (specialHours || [])
          .find(
            item => item.date === dateString
          );


      let isOpen = false;
      let startMinutes = null;
      let endMinutes = null;


      if (exception) {

        isOpen =
          exception.is_open === true;

        if (isOpen) {

          startMinutes =
            timeToMinutes(
              exception.start_time
            );

          endMinutes =
            timeToMinutes(
              exception.end_time
            );

        }

      } else {

        const normal =
          (openingHours || [])
            .find(
              item =>
                item.day_of_week === dayOfWeek
            );


        if (
          normal &&
          normal.is_open === true
        ) {

          isOpen = true;

          startMinutes =
            timeToMinutes(
              normal.start_time
            );

          endMinutes =
            timeToMinutes(
              normal.end_time
            );

        }

      }


      /*
       Jour fermé
      */

      if (!isOpen) {
        continue;
      }


      /*
       Génération de chaque pack
      */

      for (const session of sessions) {

        for (
          let start = startMinutes;
          start < endMinutes;
          start += STEP_MINUTES
        ) {

          const finish =
            start + session.duration;


          /*
           Le pack doit rentrer entièrement
           dans la plage d'ouverture.
          */

          if (finish > endMinutes) {
            continue;
          }


          const time =
            minutesToTime(start);


          const key =
            `${dateString}_${time.substring(0, 5)}_${session.id}`;


          /*
           Existe déjà
          */

          if (
            existingSlotMap.has(key)
          ) {

            continue;

          }


          /*
           Vérifier les périodes bloquées
          */

          const manuallyBlocked =
            (blockedPeriods || [])
              .some(block => {

                if (
                  block.date !== dateString
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

              });


          if (manuallyBlocked) {

            /*
             On crée quand même le créneau,
             mais comme indisponible, afin de
             conserver une trace visible dans l'admin.
            */

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


          /*
           Créneau disponible
          */

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


    /*
     -------------------------------------------------------
     8. ENREGISTRER LES NOUVEAUX CRENEAUX
     -------------------------------------------------------
    */

    if (slotsToCreate.length > 0) {

      const {
        error: insertError
      } = await supabase
        .from("slots")
        .insert(slotsToCreate);


      if (insertError) {

        /*
         Une requête simultanée peut avoir essayé
         de créer les mêmes créneaux.
        */

        console.error(
          "Generation slots:",
          insertError
        );

      }

    }


    /*
     -------------------------------------------------------
     9. RELIRE LE PLANNING
     -------------------------------------------------------
    */

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


    /*
     -------------------------------------------------------
     10. MARQUER LES CRENEAUX RESERVES
     -------------------------------------------------------
     
     Si un booking existe, on ne renvoie jamais
     le créneau comme disponible.
    */

    const bookingSlotIds =
      new Set(
        (bookings || [])
          .map(booking => booking.slot_id)
      );


    const result =
      (finalSlots || [])
        .map(slot => {

          const isBooked =
            bookingSlotIds.has(
              slot.id
            );


          if (isBooked) {

            return {

              ...slot,

              status:
                "unavailable"

            };

          }


          return slot;

        });


    /*
     -------------------------------------------------------
     11. REPONSE
     -------------------------------------------------------
    */

    return res.status(200).json(result);


  } catch (error) {

    console.error(error);

    return res.status(500).json({

      error:
        error.message ||
        "Erreur serveur"

    });

  }

}
