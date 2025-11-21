module.exports = async (req, res) => {
  // Mock hourly data
  const hourlyData = [];
  for (let i = 0; i < 24; i++) {
    hourlyData.push({
      hour: i.toString().padStart(2, '0'),
      avgPower: Math.random() * 500 + 100
    });
  }
  res.json(hourlyData);
};