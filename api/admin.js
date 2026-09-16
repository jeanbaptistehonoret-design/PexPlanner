import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

export default async function handler(req, res) {

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {

    const {
      password,
      action
    } = req.body || {};

    /* =====================================================
       SECURITE
       ===================================================== */

    if (
      !password ||
      password !== process.env.ADMIN_PASSWORD
    ) {
      return res.status(401).json({
        error: "Mot de passe incorrect"
      });
    }


    /* =====================================================
       LOGIN
       ===================================================== */

    if (action === "login") {

      return res.status(200).json({
        success: true
      });

    }


    /* =====================================================
       DONNEES ADMIN
       ===================================================== */

    if (action === "data") {

      const {
        data: sessions,
        error: sessionsError
      } = await supabase
        .from("sessions")
        .select("*")
        .eq("active", true)
        .order("duration")
        .order("name");

      if (sessionsError) {
        throw sessionsError;
      }


      const {
        data: slots,
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
        .order("date")
        .order("time");

      if (slotsError) {
        throw slotsError;
      }


      const {
        data: bookings,
        error: bookingsError
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
          partner_name,
          created_at
        `)
        .order("created_at", {
          ascending: false
        });

      if (bookingsError) {
        throw bookingsError;
      }


      const {
        data: openingHours,
        error: openingError
      } = await supabase
        .from("opening_hours")
        .select("*")
        .order("day_of_week");

      if (openingError) {
        throw openingError;
      }


      const {
        data: specialHours,
        error: specialError
      } = await supabase
        .from("special_hours")
        .select("*")
        .order("date")
        .order("start_time");

      if (specialError) {
        throw specialError;
      }


      const {
        data: blockedPeriods,
        error: blockedError
      } = await supabase
        .from("blocked_periods")
        .select("*")
        .order("date")
        .order("start_time");

      if (blockedError) {
        throw blockedError;
      }


      return res.status(200).json({

        sessions:
          sessions || [],

        slots:
          slots || [],

        bookings:
          bookings || [],

        openingHours:
          openingHours || [],

        specialHours:
          specialHours || [],

        blockedPeriods:
          blockedPeriods || []

      });

    }


    /* =====================================================
       MODIFIER HORAIRES HABITUELS
       ===================================================== */

    if (
      action === "updateOpeningHours"
    ) {

      const {
        dayOfWeek,
        isOpen,
        startTime,
        endTime
      } = req.body;


      if (
        dayOfWeek === undefined ||
        isOpen === undefined
      ) {

        return res.status(400).json({
          error:
            "Jour et statut obligatoires"
        });

      }


      /*
       Si le jour est ouvert,
       les horaires sont obligatoires.
      */

      if (
        isOpen === true &&
        (
          !startTime ||
          !endTime
        )
      ) {

        return res.status(400).json({
          error:
            "Les horaires sont obligatoires pour un jour ouvert"
        });

      }


      if (
        isOpen === true &&
        startTime >= endTime
      ) {

        return res.status(400).json({
          error:
            "L'heure de fin doit être après l'heure de début"
        });

      }


      const {
        data,
        error
      } = await supabase
        .from("opening_hours")
        .upsert(
          {
            day_of_week:
              Number(dayOfWeek),

            is_open:
              Boolean(isOpen),

            start_time:
              isOpen
                ? startTime
                : null,

            end_time:
              isOpen
                ? endTime
                : null
          },
          {
            onConflict:
              "day_of_week"
          }
        )
        .select()
        .single();


      if (error) {
        throw error;
      }


      return res.status(200).json({

        success:
          true,

        openingHours:
          data

      });

    }


    /* =====================================================
       CREER UN CRENEAU MANUEL
       ===================================================== */

    if (
      action === "createSlot"
    ) {

      const {
        date,
        time,
        sessionId,
        source,
        note
      } = req.body;


      if (
        !date ||
        !time ||
        !sessionId
      ) {

        return res.status(400).json({
          error:
            "Date, heure et séance obligatoires"
        });

      }


      const {
        data: existing
      } = await supabase
        .from("slots")
        .select("id")
        .eq("date", date)
        .eq("time", time)
        .eq(
          "session_id",
          sessionId
        )
        .limit(1);


      if (
        existing &&
        existing.length > 0
      ) {

        return res.status(409).json({
          error:
            "Ce créneau existe déjà"
        });

      }


      const {
        data: slot,
        error
      } = await supabase
        .from("slots")
        .insert({

          date,

          time,

          session_id:
            sessionId,

          status:
            source === "partner"
              ? "unavailable"
              : "available",

          source:
            source ||
            "pilotexperience",

          note:
            note ||
            null

        })
        .select()
        .single();


      if (error) {
        throw error;
      }


      return res.status(201).json({
        success: true,
        slot
      });

    }


    /* =====================================================
       MODIFIER CRENEAU
       ===================================================== */

    if (
      action === "changeSlot"
    ) {

      const {
        slotId,
        status
      } = req.body;


      if (
        !slotId ||
        !status
      ) {

        return res.status(400).json({
          error:
            "Informations manquantes"
        });

      }


      if (
        status !== "available" &&
        status !== "unavailable"
      ) {

        return res.status(400).json({
          error:
            "Statut invalide"
        });

      }


      if (
        status === "available"
      ) {

        const {
          data: existingBookings
        } = await supabase
          .from("bookings")
          .select("id")
          .eq(
            "slot_id",
            slotId
          )
          .limit(1);


        if (
          existingBookings &&
          existingBookings.length > 0
        ) {

          return res.status(409).json({
            error:
              "Ce créneau possède déjà une réservation."
          });

        }

      }


      const {
        data: slot,
        error
      } = await supabase
        .from("slots")
        .update({
          status
        })
        .eq(
          "id",
          slotId
        )
        .select()
        .single();


      if (error) {
        throw error;
      }


      return res.status(200).json({

        success:
          true,

        slot

      });

    }


    /* =====================================================
       RESERVATION PARTENAIRE
       ===================================================== */

    if (
      action === "partnerBooking"
    ) {

      const {
        slotId,
        firstName,
        lastName,
        email,
        phone,
        ticket,
        participants,
        comment,
        partner
      } = req.body;


      if (
        !slotId ||
        !firstName ||
        !lastName ||
        !ticket ||
        !partner
      ) {

        return res.status(400).json({
          error:
            "Créneau, partenaire, prénom, nom et billet obligatoires"
        });

      }


      const {
        data: slot,
        error: slotError
      } = await supabase
        .from("slots")
        .select(`
          id,
          status,
          date,
          time,
          session_id
        `)
        .eq(
          "id",
          slotId
        )
        .single();


      if (
        slotError ||
        !slot
      ) {

        return res.status(404).json({
          error:
            "Créneau introuvable"
        });

      }


      if (
        slot.status !==
        "available"
      ) {

        return res.status(409).json({
          error:
            "Ce créneau n'est plus disponible"
        });

      }


      const {
        data: existingBooking
      } = await supabase
        .from("bookings")
        .select("id")
        .eq(
          "slot_id",
          slotId
        )
        .limit(1);


      if (
        existingBooking &&
        existingBooking.length > 0
      ) {

        return res.status(409).json({
          error:
            "Ce créneau possède déjà une réservation"
        });

      }


      const {
        data: booking,
        error: bookingError
      } = await supabase
        .from("bookings")
        .insert({

          slot_id:
            slotId,

          first_name:
            firstName,

          last_name:
            lastName,

          email:
            email ||
            null,

          phone:
            phone ||
            null,

          ticket:
            ticket,

          participants:
            Number(
              participants
            ) || 1,

          comment:
            comment ||
            null,

          source:
            "partner",

          partner_name:
            partner

        })
        .select()
        .single();


      if (bookingError) {
        throw bookingError;
      }


      const {
        error: updateError
      } = await supabase
        .from("slots")
        .update({

          status:
            "unavailable",

          source:
            "partner",

          note:
            `Partenaire : ${partner}`

        })
        .eq(
          "id",
          slotId
        );


      if (updateError) {
        throw updateError;
      }


      return res.status(201).json({

        success:
          true,

        booking

      });

    }


    /* =====================================================
       LIBERER CRENEAU
       ===================================================== */

    if (
      action === "releaseSlot"
    ) {

      const {
        slotId
      } = req.body;


      if (!slotId) {

        return res.status(400).json({
          error:
            "Identifiant manquant"
        });

      }


      const {
        data: existingBookings
      } = await supabase
        .from("bookings")
        .select("id")
        .eq(
          "slot_id",
          slotId
        )
        .limit(1);


      if (
        existingBookings &&
        existingBookings.length > 0
      ) {

        return res.status(409).json({
          error:
            "Ce créneau possède une réservation."
        });

      }


      const {
        error
      } = await supabase
        .from("slots")
        .update({

          status:
            "available",

          source:
            "pilotexperience",

          note:
            null

        })
        .eq(
          "id",
          slotId
        );


      if (error) {
        throw error;
      }


      return res.status(200).json({
        success: true
      });

    }


    /* =====================================================
       SUPPRIMER CRENEAU
       ===================================================== */

    if (
      action === "deleteSlot"
    ) {

      const {
        slotId
      } = req.body;


      if (!slotId) {

        return res.status(400).json({
          error:
            "Identifiant manquant"
        });

      }


      const {
        data: existingBookings
      } = await supabase
        .from("bookings")
        .select("id")
        .eq(
          "slot_id",
          slotId
        )
        .limit(1);


      if (
        existingBookings &&
        existingBookings.length > 0
      ) {

        return res.status(409).json({
          error:
            "Impossible : ce créneau possède une réservation."
        });

      }


      const {
        error
      } = await supabase
        .from("slots")
        .delete()
        .eq(
          "id",
          slotId
        );


      if (error) {
        throw error;
      }


      return res.status(200).json({
        success: true
      });

    }


    /* =====================================================
       OUVERTURE EXCEPTIONNELLE
       ===================================================== */

    if (
      action === "createSpecialHours"
    ) {

      const {
        date,
        startTime,
        endTime,
        note
      } = req.body;


      if (
        !date ||
        !startTime ||
        !endTime
      ) {

        return res.status(400).json({
          error:
            "Date et horaires obligatoires"
        });

      }


      if (
        startTime >= endTime
      ) {

        return res.status(400).json({
          error:
            "L'heure de fin doit être après l'heure de début"
        });

      }


      const {
        data,
        error
      } = await supabase
        .from("special_hours")
        .insert({

          date,

          is_open:
            true,

          start_time:
            startTime,

          end_time:
            endTime,

          note:
            note ||
            null

        })
        .select()
        .single();


      if (error) {
        throw error;
      }


      return res.status(201).json({

        success:
          true,

        specialHours:
          data

      });

    }


    /* =====================================================
       SUPPRIMER OUVERTURE EXCEPTIONNELLE
       ===================================================== */

    if (
      action ===
      "deleteSpecialHours"
    ) {

      const {
        id
      } = req.body;


      if (!id) {

        return res.status(400).json({
          error:
            "Identifiant manquant"
        });

      }


      const {
        error
      } = await supabase
        .from("special_hours")
        .delete()
        .eq(
          "id",
          id
        );


      if (error) {
        throw error;
      }


      return res.status(200).json({
        success: true
      });

    }


    /* =====================================================
       CREER BLOCAGE
       ===================================================== */

    if (
      action ===
      "createBlockedPeriod"
    ) {

      const {
        date,
        startTime,
        endTime,
        reason
      } = req.body;


      if (
        !date ||
        !startTime ||
        !endTime
      ) {

        return res.status(400).json({
          error:
            "Date et horaires obligatoires"
        });

      }


      if (
        startTime >= endTime
      ) {

        return res.status(400).json({
          error:
            "L'heure de fin doit être après l'heure de début"
        });

      }


      const {
        data,
        error
      } = await supabase
        .from("blocked_periods")
        .insert({

          date,

          start_time:
            startTime,

          end_time:
            endTime,

          reason:
            reason ||
            null,

          source:
            "pilotexperience"

        })
        .select()
        .single();


      if (error) {
        throw error;
      }


      return res.status(201).json({

        success:
          true,

        blockedPeriod:
          data

      });

    }


    /* =====================================================
       SUPPRIMER BLOCAGE
       ===================================================== */

    if (
      action ===
      "deleteBlockedPeriod"
    ) {

      const {
        id
      } = req.body;


      if (!id) {

        return res.status(400).json({
          error:
            "Identifiant manquant"
        });

      }


      const {
        error
      } = await supabase
        .from("blocked_periods")
        .delete()
        .eq(
          "id",
          id
        );


      if (error) {
        throw error;
      }


      return res.status(200).json({
        success: true
      });

    }


    /* =====================================================
       ACTION INCONNUE
       ===================================================== */

    return res.status(400).json({
      error:
        "Action inconnue"
    });


  } catch (error) {

    console.error(error);

    return res.status(500).json({
      error:
        error.message ||
        "Erreur serveur"
    });

  }

}
