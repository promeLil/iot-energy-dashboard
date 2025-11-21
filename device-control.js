const { TuyaContext } = require('@tuya/tuya-connector-nodejs');

// Tuya context initialize করুন
const context = new TuyaContext({
  accessKey: process.env.TUYA_ACCESS_ID,
  secretKey: process.env.TUYA_ACCESS_KEY,
  baseUrl: `https://openapi.tuya${process.env.TUYA_REGION || 'us'}.com`
});

const deviceId = process.env.TUYA_DEVICE_ID;

module.exports = async (req, res) => {
  // শুধুমাত্র POST request allow করুন
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { command } = req.body;

    // Validate command
    if (!command) {
      return res.status(400).json({ error: 'Command is required' });
    }

    // Tuya ডিভাইসে command পাঠান
    const response = await context.request({
      method: 'POST',
      path: `/v1.0/devices/${deviceId}/commands`,
      body: {
        commands: [command]
      }
    });

    // Success response
    res.json({ 
      success: true, 
      message: 'Command sent successfully',
      response: response.result 
    });

  } catch (error) {
    console.error('Device Control Error:', error.message);
    
    // Error response
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
};