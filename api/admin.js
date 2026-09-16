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
       CONNEXION
       ===================================================== */

    if (action === "login") {

      return res.status(200).json({
        success: true
      });

    }


    /* =====================================================
       RECUPERER TOUTES LES DONNEES
       ===================================================== */

    if (action === "data") {

      const {
        data: sessions,
        error: sessionsError
      } = await supabase
        .from("sessions")
        .select("*")
        .eq("active", true)
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
        .order("date", {
          ascending: true
        })
        .order("time", {
          ascending: true
        });

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
          first_name,
          last_name,
          email,
          phone,
          ticket,
          participants,
          comment,
          source,
          created_at,
          slot_id
        `)
        .order("created_at", {
          ascending: false
        });

      if (bookingsError) {
        throw bookingsError;
      }


      return res.status(200).json({
        sessions,
        slots,
        bookings
      });

    }


    /* =====================================================
       CREER UN CRENEAU
       ===================================================== */

    if (action === "createSlot") {

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


      /*
       Vérification du doublon
      */

      const {
        data: existing
      } = await supabase
        .from("slots")
        .select("id")
        .eq("date", date)
        .eq("time", time)
        .eq("session_id", sessionId)
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
          session_id: sessionId,
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
       MODIFIER LE STATUT D'UN CRENEAU
       ===================================================== */

    if (action === "changeSlot") {

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


      /*
       Impossible de libérer un créneau
       qui possède déjà une réservation
      */

      if (
        status === "available"
      ) {

        const {
          data: bookings
        } = await supabase
          .from("bookings")
          .select("id")
          .eq("slot_id", slotId)
          .limit(1);


        if (
          bookings &&
          bookings.length > 0
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
        .eq("id", slotId)
        .select()
        .single();


      if (error) {
        throw error;
      }


      return res.status(200).json({
        success: true,
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
            "Créneau, partenaire, nom et numéro de billet obligatoires"
        });

      }


      /*
       Vérifier le créneau
      */

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
          session_id,
          sessions (
            id,
            name,
            duration
          )
        `)
        .eq("id", slotId)
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
        slot.status !== "available"
      ) {

        return res.status(409).json({
          error:
            "Ce créneau n'est plus disponible"
        });

      }


      /*
       Vérifier qu'il n'existe
       pas déjà une réservation
      */

      const {
        data: existingBooking,
        error: existingBookingError
      } = await supabase
        .from("bookings")
        .select("id")
        .eq("slot_id", slotId)
        .limit(1);


      if (existingBookingError) {
        throw existingBookingError;
      }


      if (
        existingBooking &&
        existingBooking.length > 0
      ) {

        return res.status(409).json({
          error:
            "Ce créneau possède déjà une réservation"
        });

      }


      /*
       Créer la réservation
      */

      const {
        data: booking,
        error: bookingError
      } = await supabase
        .from("bookings")
        .insert({

          slot_id: slotId,

          first_name:
            firstName,

          last_name:
            lastName,

          email:
            email || null,

          phone:
            phone || null,

          ticket:
            ticket,

          participants:
            Number(participants) || 1,

          comment:
            comment || null,

          source:
            partner

        })
        .select()
        .single();


      if (bookingError) {
        throw bookingError;
      }


      /*
       Bloquer le créneau
      */

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

        success: true,

        booking

      });

    }


    /* =====================================================
       SUPPRIMER UN CRENEAU
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
            "Identifiant du créneau manquant"
        });

      }


      /*
       Ne jamais supprimer
       un créneau avec réservation
      */

      const {
        data: bookings
      } = await supabase
        .from("bookings")
        .select("id")
        .eq(
          "slot_id",
          slotId
        )
        .limit(1);


      if (
        bookings &&
        bookings.length > 0
      ) {

        return res.status(409).json({
          error:
            "Impossible de supprimer ce créneau : il possède une réservation."
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
       LIBERER UN CRENEAU
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
            "Identifiant du créneau manquant"
        });

      }


      /*
       Vérifier qu'il n'y a pas
       déjà une réservation
      */

      const {
        data: bookings
      } = await supabase
        .from("bookings")
        .select("id")
        .eq(
          "slot_id",
          slotId
        )
        .limit(1);


      if (
        bookings &&
        bookings.length > 0
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
