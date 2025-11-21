require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Tuya SDK
const { TuyaContext } = require('@tuya/tuya-connector-nodejs');

// Initialize Express
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use(express.static(path.join(__dirname, '/')));

// Initialize SQLite DB
const db = new sqlite3.Database('./energy.db', (err) => {
    if (err) console.error('DB Error:', err);
    else console.log('Connected to SQLite database');
});

// Create tables if they don't exist
db.run(`CREATE TABLE IF NOT EXISTS energy_data (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT,
    power REAL,
    voltage REAL,
    current REAL,
    power_factor REAL
)`);

db.run(`CREATE TABLE IF NOT EXISTS device_commands (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT,
    command TEXT,
    value TEXT,
    success INTEGER
)`);

db.run(`CREATE TABLE IF NOT EXISTS system_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT,
    event_type TEXT,
    message TEXT
)`);

// Initialize Tuya context
const context = new TuyaContext({
    accessKey: process.env.TUYA_ACCESS_ID,
    secretKey: process.env.TUYA_ACCESS_KEY,
    baseUrl: `https://openapi.tuya${process.env.TUYA_REGION}.com`
});

const deviceId = process.env.TUYA_DEVICE_ID;

// Log system event
function logSystemEvent(eventType, message) {
    db.run(
        `INSERT INTO system_events (timestamp, event_type, message) VALUES (?, ?, ?)`,
        [new Date().toISOString(), eventType, message],
        (err) => {
            if (err) console.error('System Event Logging Error:', err);
        }
    );
}

// Function to collect energy data
async function collectEnergyData() {
    try {
        const res = await context.request({
            method: 'GET',
            path: `/v1.0/devices/${deviceId}/status`,
        });

        const deviceStatus = res.result || [];

        const power       = deviceStatus.find(s => s.code === 'cur_power')?.value || 0;
        const voltage     = deviceStatus.find(s => s.code === 'cur_voltage')?.value || 0;
        const current     = deviceStatus.find(s => s.code === 'cur_current')?.value || 0;
        const powerFactor = deviceStatus.find(s => s.code === 'power_factor')?.value || 0;

        const timestamp = new Date().toISOString();

        db.run(
            `INSERT INTO energy_data (timestamp, power, voltage, current, power_factor) VALUES (?, ?, ?, ?, ?)`,
            [timestamp, power, voltage, current, powerFactor],
            function(err) {
                if (err) {
                    console.error('DB Insert Error:', err);
                    logSystemEvent('ERROR', `Failed to save energy data: ${err.message}`);
                } else {
                    console.log(`Data logged at ${timestamp}: ${power} W`);
                }
            }
        );

    } catch (err) {
        console.error('Tuya API Error:', err.message);
        logSystemEvent('ERROR', `Tuya API Error: ${err.message}`);
        
        // Save error data with zero values to maintain data continuity
        const timestamp = new Date().toISOString();
        db.run(
            `INSERT INTO energy_data (timestamp, power, voltage, current, power_factor) VALUES (?, ?, ?, ?, ?)`,
            [timestamp, 0, 0, 0, 0],
            function(err) {
                if (err) {
                    console.error('DB Insert Error for fallback data:', err);
                }
            }
        );
    }
}

// *** MODIFICATION: Collect data every 1 second ***
cron.schedule('* * * * * *', collectEnergyData);

// API: Get latest data
app.get('/api/current-data', (req, res) => {
    db.get(`SELECT * FROM energy_data ORDER BY id DESC LIMIT 1`, (err, row) => {
        if (err) {
            res.status(500).json({ error: err.message });
        } else {
            res.json(row);
        }
    });
});

// API: Get last 24h hourly avg
app.get('/api/daily-data', (req, res) => {
    db.all(
        `SELECT strftime('%H', timestamp) as hour, AVG(power) as avgPower 
         FROM energy_data 
         WHERE timestamp >= datetime('now','-1 day')
         GROUP BY hour`,
        (err, rows) => {
            if (err) {
                res.status(500).json({ error: err.message });
            } else {
                res.json(rows);
            }
        }
    );
});

// API: Get historical data
app.get('/api/historical-data', (req, res) => {
    const { startDate, endDate } = req.query;
    // Add time to endDate to include the full day
    const endDateTime = endDate ? `${endDate}T23:59:59` : undefined;
    db.all(
        `SELECT * FROM energy_data WHERE timestamp BETWEEN ? AND ? ORDER BY timestamp`,
        [startDate, endDateTime],
        (err, rows) => {
            if (err) {
                res.status(500).json({ error: err.message });
            } else {
                res.json(rows);
            }
        }
    );
});

// API: Get recent readings
app.get('/api/recent-readings', (req, res) => {
    db.all(
        `SELECT * FROM energy_data ORDER BY id DESC LIMIT 10`,
        (err, rows) => {
            if (err) {
                res.status(500).json({ error: err.message });
            } else {
                res.json(rows);
            }
        }
    );
});

// API: Get today's usage
app.get('/api/today-usage', (req, res) => {
    const today = new Date().toISOString().split('T')[0];
    db.all(
        `SELECT * FROM energy_data WHERE date(timestamp) = ?`,
        [today],
        (err, rows) => {
            if (err) {
                res.status(500).json({ error: err.message });
            } else {
                let totalPower = 0;
                let previousTimestamp = null;
                
                rows.forEach(row => {
                    if (previousTimestamp) {
                        const timeDiff = (new Date(row.timestamp) - new Date(previousTimestamp)) / 1000 / 3600; // hours
                        totalPower += (row.power / 1000) * timeDiff; // kWh
                    }
                    previousTimestamp = row.timestamp;
                });
                
                res.json({ 
                    usage: totalPower.toFixed(3), 
                    readings: rows.length
                });
            }
        }
    );
});

// API: Get monthly usage
app.get('/api/monthly-usage', (req, res) => {
    const currentMonth = new Date().toISOString().slice(0, 7);
    db.all(
        `SELECT * FROM energy_data WHERE strftime('%Y-%m', timestamp) = ?`,
        [currentMonth],
        (err, rows) => {
            if (err) {
                res.status(500).json({ error: err.message });
            } else {
                let totalPower = 0;
                let previousTimestamp = null;
                
                rows.forEach(row => {
                    if (previousTimestamp) {
                        const timeDiff = (new Date(row.timestamp) - new Date(previousTimestamp)) / 1000 / 3600; // hours
                        totalPower += (row.power / 1000) * timeDiff; // kWh
                    }
                    previousTimestamp = row.timestamp;
                });
                
                const monthlyCost = totalPower * 0.12; // Assuming $0.12 per kWh
                
                res.json({ 
                    usage: totalPower.toFixed(3), 
                    cost: monthlyCost.toFixed(2),
                    readings: rows.length
                });
            }
        }
    );
});

// API: Cost Analysis
app.get('/api/cost-analysis', (req, res) => {
    db.all(
        `SELECT strftime('%m', timestamp) as month, 
                strftime('%Y', timestamp) as year,
                SUM(power) as totalPower
         FROM energy_data 
         GROUP BY year, month`,
        (err, rows) => {
            if (err) {
                res.status(500).json({ error: err.message });
            } else {
                const costData = rows.map(row => ({
                    ...row,
                    totalCost: (row.totalPower * 0.12 / 1000).toFixed(2) // Convert to kWh and calculate cost
                }));
                
                res.json(costData);
            }
        }
    );
});

// *** NEW API: Get all data grouped by date for the "All Data" tab ***
app.get('/api/all-data', (req, res) => {
    db.all(
        `SELECT date(timestamp) as date, 
                COUNT(*) as readings,
                MIN(power) as minPower,
                MAX(power) as maxPower,
                AVG(power) as avgPower,
                SUM(power) as totalPower
         FROM energy_data 
         GROUP BY date(timestamp)
         ORDER BY date DESC`,
        (err, rows) => {
            if (err) {
                res.status(500).json({ error: err.message });
            } else {
                res.json(rows);
            }
        }
    );
});

// *** NEW API: Get detailed data for a specific date ***
app.get('/api/date-data/:date', (req, res) => {
    const { date } = req.params;
    db.all(
        `SELECT * FROM energy_data WHERE date(timestamp) = ? ORDER BY timestamp`,
        [date],
        (err, rows) => {
            if (err) {
                res.status(500).json({ error: err.message });
            } else {
                res.json(rows);
            }
        }
    );
});


// API: Control device
app.post('/api/control-device', async (req, res) => {
    try {
        const { command } = req.body;
        
        const response = await context.request({
            method: 'POST',
            path: `/v1.0/devices/${deviceId}/commands`,
            body: {
                commands: [command]
            }
        });
        
        db.run(
            `INSERT INTO device_commands (timestamp, command, value, success) VALUES (?, ?, ?, ?)`,
            [new Date().toISOString(), command.code, JSON.stringify(command.value), 1],
            function(err) {
                if (err) console.error('Command Logging Error:', err);
            }
        );
        
        res.json({ success: true, response });
    } catch (err) {
        console.error('Device Control Error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});


// API: Get system status 
app.get('/api/system-status', (req, res) => {
    db.get(`SELECT COUNT(*) as totalReadings FROM energy_data`, (err, row) => {
        if (err) {
            res.status(500).json({ error: err.message });
        } else {
            db.get(`SELECT timestamp FROM energy_data ORDER BY id DESC LIMIT 1`, (err, lastRow) => {
                if (err) {
                    res.status(500).json({ error: err.message });
                } else {
                    db.get(`SELECT COUNT(*) as errorCount FROM system_events WHERE event_type = 'ERROR'`, (err, errorRow) => {
                        if (err) {
                            res.status(500).json({ error: err.message });
                        } else {
                            res.json({
                                totalReadings: row.totalReadings,
                                lastReading: lastRow?.timestamp,
                                errorCount: errorRow.errorCount,
                                uptime: process.uptime(),
                                serverOnline: true 
                            });
                        }
                    });
                }
            });
        }
    });
});
// Run server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});

