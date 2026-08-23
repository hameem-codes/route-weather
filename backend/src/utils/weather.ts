export function getWeatherSeverity(wmoCode: number, windSpeed: number) {
  let condition = "Clear";
  let severity = "safe";
  let icon = "Sun";
  let alert: string | null = null;
  let riskAssessment = "Optimal driving conditions.";

  if (wmoCode === 0) { condition = "Clear"; icon = "Sun"; }
  else if (wmoCode === 1 || wmoCode === 2) { condition = "Partly Cloudy"; icon = "Cloud"; }
  else if (wmoCode === 3) { condition = "Overcast"; icon = "Cloud"; }
  else if (wmoCode >= 45 && wmoCode <= 48) { condition = "Fog"; icon = "Cloud"; severity = "warning"; riskAssessment = "Reduced visibility. Drive with caution."; }
  else if (wmoCode >= 51 && wmoCode <= 57) { condition = "Drizzle"; icon = "CloudRain"; }
  else if (wmoCode >= 61 && wmoCode <= 65) { 
    condition = "Rain"; icon = "CloudRain"; severity = "warning"; riskAssessment = "Reduced traction. Increase following distance.";
    if (wmoCode === 65) { condition = "Heavy Rain"; icon = "CloudLightning"; alert = "Heavy Downpour"; riskAssessment = "High risk of hydroplaning."; }
  }
  else if (wmoCode >= 71 && wmoCode <= 77) {
    condition = "Snow"; icon = "Snowflake"; severity = "critical"; riskAssessment = "Severe winter conditions."; alert = "Snow/Ice on roads";
  }
  else if (wmoCode >= 80 && wmoCode <= 82) {
    condition = "Rain Showers"; icon = "CloudRain"; severity = "warning";
  }
  else if (wmoCode >= 85 && wmoCode <= 86) {
    condition = "Snow Showers"; icon = "CloudSnow"; severity = "critical"; alert = "Snow Showers";
  }
  else if (wmoCode >= 95) {
    condition = "Thunderstorm"; icon = "CloudLightning"; severity = "critical"; alert = "Thunderstorm Warning"; riskAssessment = "Dangerous driving conditions.";
  }

  if (windSpeed > 30) {
    severity = "critical"; alert = "High Wind Warning"; riskAssessment = "Dangerous crosswinds for high-profile vehicles.";
  }

  return { condition, severity, icon, alert, riskAssessment };
}
