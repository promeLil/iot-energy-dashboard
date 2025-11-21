const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://htxmttxlevkinnuyjeey.supabase.co';
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = async (req, res) => {
  try {
    // Supabase থেকে মোট রিডিং সংখ্যা পান
    const { count: totalReadings, error: countError } = await supabase
      .from('energy_data')
      .select('*', { count: 'exact', head: true });

    if (countError) {
      return res.status(500).json({ error: countError.message });
    }

    // সর্বশেষ রিডিং এর সময় পান
    const { data, error } = await supabase
      .from('energy_data')
      .select('timestamp')
      .order('id', { ascending: false })
      .limit(1);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({
      totalReadings: totalReadings || 0,
      lastReading: data && data.length > 0 ? data[0].timestamp : null,
      errorCount: 0,
      uptime: 7200,
      serverOnline: true
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};