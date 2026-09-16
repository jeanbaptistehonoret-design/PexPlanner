import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

export default async function handler(req, res) {

  // On accepte uniquement POST
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {

    const {
      slotId,
      firstName,
      lastName,
      email,
      phone,
      ticket,
      participants,
      comment
    } = req.body;

    // Vérification des champs obligatoires
    if (
      !slotId ||
      !firstName ||
      !lastName ||
      !email ||
      !ticket
    ) {
      return res.status(400).json({
        error: "Champs obligatoires manquants"
      });
    }

    // Vérifie que le créneau existe
    const { data: slot, error: slotError } = await supabase
      .from("slots")
      .select(`
        id,
        date,
        time,
        status,
        session_id,
        sessions (
          id,
          name,
          duration
        )
      `)
      .eq("id", slotId)
      .single();

    if (slotError || !slot) {
      return res.status(404).json({
        error: "Créneau introuvable"
      });
    }

    // Vérifie que le créneau est disponible
    if (slot.status !== "available") {
      return res.status(409).json({
        error: "Ce créneau n'est plus disponible"
      });
    }

    // Vérifie également qu'il n'existe pas déjà
    // une réservation pour ce créneau
    const { data: existingBooking, error: existingError } =
      await supabase
        .from("bookings")
        .select("id")
        .eq("slot_id", slotId)
        .limit(1);

    if (existingError) {
      return res.status(500).json({
        error: existingError.message
      });
    }

    if (existingBooking && existingBooking.length > 0) {
      return res.status(409).json({
        error: "Ce créneau vient d'être réservé"
      });
    }

    // Création de la réservation
    const { data: booking, error: bookingError } =
      await supabase
        .from("bookings")
        .insert({
          slot_id: slotId,
          first_name: firstName,
          last_name: lastName,
          email: email,
          phone: phone || null,
          ticket: ticket,
          participants: Number(participants) || 1,
          comment: comment || null,
          source: "site"
        })
        .select()
        .single();

    if (bookingError) {
      return res.status(500).json({
        error: bookingError.message
      });
    }

    // Le créneau devient indisponible
    const { error: updateError } =
      await supabase
        .from("slots")
        .update({
          status: "unavailable"
        })
        .eq("id", slotId);

    if (updateError) {
      return res.status(500).json({
        error: updateError.message
      });
    }

    return res.status(201).json({
      success: true,
      booking: booking,
      message: "Réservation enregistrée"
    });

  } catch (error) {

    console.error(error);

    return res.status(500).json({
      error: "Erreur serveur"
    });

  }
}
