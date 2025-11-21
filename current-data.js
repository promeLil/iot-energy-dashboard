const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://htxmttxlevkinnuyjeey.supabase.co';
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = async (req, res) => {
  try {
    // Supabase থেকে সর্বশেষ ডেটা পান
    const { data, error } = await supabase
      .from('energy_data')
      .select('*')
      .order('id', { ascending: false })
      .limit(1);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    if (data && data.length > 0) {
      res.json(data[0]);
    } else {
      res.json({ power: 0, voltage: 0, current: 0, power_factor: 0 });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};