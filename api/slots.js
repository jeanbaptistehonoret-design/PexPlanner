import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  const { data, error } = await supabase
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

  if (error) {
    return res.status(500).json({
      error: error.message
    });
  }

  return res.status(200).json(data);
}
