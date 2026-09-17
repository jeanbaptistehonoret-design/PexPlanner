import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

export default async function handler(req, res) {

  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  try {

    const body = req.body || {};

    const action = body.action;
    const password = body.password;

    /* =========================
       VERIFICATION MOT DE PASSE
    ========================= */

    if (password !== process.env.ADMIN_PASSWORD) {
      return res.status(401).json({
        success: false,
        error: "Mot de passe incorrect."
      });
    }


    /* =========================
       LOGIN
    ========================= */

    if (action === "login") {
      return res.status(200).json({
        success: true
      });
    }


    /* =========================
       CHARGEMENT DES DONNEES
    ========================= */

    if (action === "data") {

      const [
        sessionsResult,
        slotsResult,
        bookingsResult,
        openingHoursResult,
        specialHoursResult,
        blockedPeriodsResult
      ] = await Promise.all([

        supabase
          .from("sessions")
          .select("*")
          .order("name"),

        supabase
          .from("slots")
          .select("*")
          .order("date")
          .order("time"),

        supabase
          .from("bookings")
          .select("*")
          .order("created_at", {
            ascending: false
          }),

        supabase
          .from("opening_hours")
          .select("*")
          .order("day_of_week"),

        supabase
          .from("special_hours")
          .select("*")
          .order("date"),

        supabase
          .from("blocked_periods")
          .select("*")
          .order("date")
          .order("start_time")

      ]);


      /* =========================
         VERIFICATION ERREURS
      ========================= */

      if (sessionsResult.error) {
        console.error("sessions:", sessionsResult.error);

        throw new Error(
          "Erreur sessions : " +
          sessionsResult.error.message
        );
      }

      if (slotsResult.error) {
        console.error("slots:", slotsResult.error);

        throw new Error(
          "Erreur slots : " +
          slotsResult.error.message
        );
      }

      if (bookingsResult.error) {
        console.error("bookings:", bookingsResult.error);

        throw new Error(
          "Erreur bookings : " +
          bookingsResult.error.message
        );
      }

      if (openingHoursResult.error) {
        console.error(
          "opening_hours:",
          openingHoursResult.error
        );

        throw new Error(
          "Erreur opening_hours : " +
          openingHoursResult.error.message
        );
      }

      if (specialHoursResult.error) {
        console.error(
          "special_hours:",
          specialHoursResult.error
        );

        throw new Error(
          "Erreur special_hours : " +
          specialHoursResult.error.message
        );
      }

      if (blockedPeriodsResult.error) {
        console.error(
          "blocked_periods:",
          blockedPeriodsResult.error
        );

        throw new Error(
          "Erreur blocked_periods : " +
          blockedPeriodsResult.error.message
        );
      }


      /* =========================
         REPONSE
      ========================= */

      return res.status(200).json({

        success: true,

        sessions:
          sessionsResult.data || [],

        slots:
          slotsResult.data || [],

        bookings:
          bookingsResult.data || [],

        openingHours:
          openingHoursResult.data || [],

        specialHours:
          specialHoursResult.data || [],

        blockedPeriods:
          blockedPeriodsResult.data || []

      });

    }


    /* =========================
       HORAIRES HABITUELS
    ========================= */

    if (action === "updateOpeningHours") {

      const hours =
        Array.isArray(body.hours)
          ? body.hours
          : [];

      for (const hour of hours) {

        const {
          day_of_week,
          is_open,
          start_time,
          end_time
        } = hour;

        const { error } = await supabase
          .from("opening_hours")
          .upsert(
            {
              day_of_week,
              is_open,
              start_time,
              end_time
            },
            {
              onConflict: "day_of_week"
            }
          );

        if (error) {
          throw new Error(
            "Erreur horaires : " +
            error.message
          );
        }
      }

      return res.status(200).json({
        success: true
      });
    }


    /* =========================
       CREATION CRENEAU
    ========================= */

    if (action === "createSlot") {

      /*
        On accepte les deux formats pour éviter
        une incompatibilité avec l'ancienne interface :

        nouveau :
        date / time

        ancien :
        slot_date / start_time
      */

      const date =
        body.date ||
        body.slot_date;

      const time =
        body.time ||
        body.start_time;

      const session_id =
        body.session_id;

      const status =
        body.status ||
        "available";


      if (
        !date ||
        !time ||
        !session_id
      ) {

        return res.status(400).json({
          success: false,
          error: "Date, heure et session sont obligatoires."
        });
      }


      const {
        data,
        error
      } = await supabase
        .from("slots")
        .insert({

          date,
          time,
          session_id,
          status

        })
        .select()
        .single();


      if (error) {

        console.error(
          "createSlot:",
          error
        );

        throw new Error(
          "Erreur création créneau : " +
          error.message
        );
      }


      return res.status(200).json({

        success: true,

        slot: data

      });
    }


    /* =========================
       MODIFIER CRENEAU
    ========================= */

    if (action === "changeSlot") {

      const {
        slotId,
        status
      } = body;

      if (!slotId) {

        return res.status(400).json({
          success: false,
          error: "Créneau manquant."
        });
      }


      const { error } =
        await supabase
          .from("slots")
          .update({
            status
          })
          .eq("id", slotId);


      if (error) {

        throw new Error(
          "Erreur modification créneau : " +
          error.message
        );
      }


      return res.status(200).json({
        success: true
      });
    }


    /* =========================
       SUPPRIMER CRENEAU
    ========================= */

    if (action === "deleteSlot") {

      const {
        slotId
      } = body;

      if (!slotId) {

        return res.status(400).json({
          success: false,
          error: "Créneau manquant."
        });
      }


      const { error } =
        await supabase
          .from("slots")
          .delete()
          .eq("id", slotId);


      if (error) {

        throw new Error(
          "Erreur suppression créneau : " +
          error.message
        );
      }


      return res.status(200).json({
        success: true
      });
    }


    /* =========================
       RESERVATION PARTENAIRE
    ========================= */

    if (action === "partnerBooking") {

      const {
        slotId,
        partner_name,
        ticket,
        participants,
        first_name,
        last_name,
        email,
        phone,
        comment
      } = body;


      if (
        !slotId ||
        !first_name ||
        !last_name
      ) {

        return res.status(400).json({
          success: false,
          error:
            "Prénom, nom et créneau sont obligatoires."
        });
      }


      /* Vérifier le créneau */

      const {
        data: slot,
        error: slotError
      } = await supabase
        .from("slots")
        .select("*")
        .eq("id", slotId)
        .single();


      if (slotError || !slot) {

        return res.status(404).json({
          success: false,
          error: "Créneau introuvable."
        });
      }


      if (slot.status !== "available") {

        return res.status(409).json({
          success: false,
          error:
            "Ce créneau n'est plus disponible."
        });
      }


      /* Créer la réservation */

      const {
        data: booking,
        error: bookingError
      } = await supabase
        .from("bookings")
        .insert({

          slot_id: slotId,

          partner_name:
            partner_name || null,

          ticket:
            ticket || null,

          participants:
            Number(participants) || 1,

          first_name,
          last_name,

          email:
            email || null,

          phone:
            phone || null,

          comment:
            comment || null

        })
        .select()
        .single();


      if (bookingError) {

        throw new Error(
          "Erreur réservation partenaire : " +
          bookingError.message
        );
      }


      /* Bloquer le créneau */

      const {
        error: updateError
      } = await supabase
        .from("slots")
        .update({
          status: "unavailable"
        })
        .eq("id", slotId);


      if (updateError) {

        throw new Error(
          "Erreur blocage créneau : " +
          updateError.message
        );
      }


      return res.status(200).json({

        success: true,

        booking

      });
    }


    /* =========================
       LIBERER RESERVATION
    ========================= */

    if (action === "releaseSlot") {

      const {
        bookingId,
        slotId
      } = body;


      if (bookingId) {

        const { error } =
          await supabase
            .from("bookings")
            .delete()
            .eq("id", bookingId);


        if (error) {

          throw new Error(
            "Erreur suppression réservation : " +
            error.message
          );
        }
      }


      if (slotId) {

        const { error } =
          await supabase
            .from("slots")
            .update({
              status: "available"
            })
            .eq("id", slotId);


        if (error) {

          throw new Error(
            "Erreur libération créneau : " +
            error.message
          );
        }
      }


      return res.status(200).json({
        success: true
      });
    }


    /* =========================
       OUVERTURE EXCEPTIONNELLE
    ========================= */

    if (action === "createSpecialHours") {

      const {
        date,
        is_open,
        start_time,
        end_time,
        note
      } = body;


      if (!date) {

        return res.status(400).json({
          success: false,
          error: "Date manquante."
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
            is_open !== false,

          start_time:
            start_time || "09:00",

          end_time:
            end_time || "19:00",

          note:
            note || null

        })
        .select()
        .single();


      if (error) {

        throw new Error(
          "Erreur ouverture exceptionnelle : " +
          error.message
        );
      }


      return res.status(200).json({

        success: true,

        specialHours: data

      });
    }


    /* =========================
       SUPPRIMER OUVERTURE
    ========================= */

    if (action === "deleteSpecialHours") {

      const {
        id
      } = body;


      if (!id) {

        return res.status(400).json({
          success: false,
          error: "Identifiant manquant."
        });
      }


      const { error } =
        await supabase
          .from("special_hours")
          .delete()
          .eq("id", id);


      if (error) {

        throw new Error(
          "Erreur suppression ouverture : " +
          error.message
        );
      }


      return res.status(200).json({
        success: true
      });
    }


    /* =========================
       CREER BLOCAGE
    ========================= */

    if (action === "createBlockedPeriod") {

      const {
        date,
        start_time,
        end_time,
        reason
      } = body;


      if (
        !date ||
        !start_time ||
        !end_time
      ) {

        return res.status(400).json({
          success: false,
          error:
            "Date et horaires obligatoires."
        });
      }


      const {
        data,
        error
      } = await supabase
        .from("blocked_periods")
        .insert({

          date,

          start_time,

          end_time,

          reason:
            reason || null,

          source:
            "admin"

        })
        .select()
        .single();


      if (error) {

        throw new Error(
          "Erreur création blocage : " +
          error.message
        );
      }


      return res.status(200).json({

        success: true,

        blockedPeriod: data

      });
    }


    /* =========================
       SUPPRIMER BLOCAGE
    ========================= */

    if (action === "deleteBlockedPeriod") {

      const {
        id
      } = body;


      if (!id) {

        return res.status(400).json({
          success: false,
          error: "Identifiant manquant."
        });
      }


      const { error } =
        await supabase
          .from("blocked_periods")
          .delete()
          .eq("id", id);


      if (error) {

        throw new Error(
          "Erreur suppression blocage : " +
          error.message
        );
      }


      return res.status(200).json({
        success: true
      });
    }


    /* =========================
       ACTION INCONNUE
    ========================= */

    return res.status(400).json({

      success: false,

      error:
        "Action inconnue : " +
        String(action)

    });

  } catch (error) {

    console.error(
      "ADMIN API ERROR:",
      error
    );


    return res.status(500).json({

      success: false,

      error:
        error.message ||
        "Erreur serveur."

    });

  }
}
