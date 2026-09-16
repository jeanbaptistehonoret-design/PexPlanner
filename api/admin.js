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

    /* =========================
       VERIFICATION MOT DE PASSE
       ========================= */

    if (
      !password ||
      password !== process.env.ADMIN_PASSWORD
    ) {
      return res.status(401).json({
        error: "Mot de passe incorrect"
      });
    }


    /* =========================
       SIMPLE TEST DE CONNEXION
       ========================= */

    if (action === "login") {

      return res.status(200).json({
        success: true
      });

    }


    /* =========================
       CHARGER LES DONNEES
       ========================= */

    if (action === "data") {

      const { data: sessions, error: sessionsError } =
        await supabase
          .from("sessions")
          .select("*")
          .eq("active", true)
          .order("name");


      if (sessionsError) {
        throw sessionsError;
      }


      const { data: slots, error: slotsError } =
        await supabase
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
          .order("date", { ascending: true })
          .order("time", { ascending: true });


      if (slotsError) {
        throw slotsError;
      }


      const { data: bookings, error: bookingsError } =
        await supabase
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
          .order("created_at", { ascending: false });


      if (bookingsError) {
        throw bookingsError;
      }


      return res.status(200).json({
        sessions,
        slots,
        bookings
      });

    }


    /* =========================
       CREER UN CRENEAU
       ========================= */

    if (action === "createSlot") {

      const {
        date,
        time,
        sessionId,
        source
      } = req.body;


      if (!date || !time || !sessionId) {

        return res.status(400).json({
          error: "Date, heure et séance obligatoires"
        });

      }


      /*
        Vérification d'un doublon exact
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


      if (existing && existing.length > 0) {

        return res.status(409).json({
          error: "Ce créneau existe déjà"
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
          status: "available",
          source: source || "pilotexperience"
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


    /* =========================
       MODIFIER UN CRENEAU
       ========================= */

    if (action === "changeSlot") {

      const {
        slotId,
        status
      } = req.body;


      if (!slotId || !status) {

        return res.status(400).json({
          error: "Informations manquantes"
        });

      }


      if (
        status !== "available" &&
        status !== "unavailable"
      ) {

        return res.status(400).json({
          error: "Statut invalide"
        });

      }


      /*
        On vérifie qu'un créneau réservé
        n'est pas libéré accidentellement.
      */

      if (status === "available") {

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
              "Ce créneau possède une réservation."
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


    return res.status(400).json({
      error: "Action inconnue"
    });


  } catch (error) {

    console.error(error);

    return res.status(500).json({
      error: error.message || "Erreur serveur"
    });

  }

}
