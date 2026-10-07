// Escuderías y pilotos ficticios. `pace` es el rendimiento del auto
// y `skill` el del piloto (1 = perfecto).

export const TEAMS = [
  { name: 'Pampa Racing', color: '#6cace4', accent: '#ffffff', pace: 1.0, drivers: [
    { name: 'Martín Ledesma', code: 'LED', number: 7, skill: 0.995 },
    { name: 'Lucía Ferraro', code: 'FER', number: 19, skill: 0.985 },
  ] },
  { name: 'Rosso Andino', color: '#d0101a', accent: '#ffd400', pace: 0.997, drivers: [
    { name: 'Santiago Quiroga', code: 'QUI', number: 16, skill: 0.993 },
    { name: 'Valentina Sosa', code: 'SOS', number: 55, skill: 0.988 },
  ] },
  { name: 'Fuego Austral', color: '#ff7a00', accent: '#1b1b1b', pace: 0.996, drivers: [
    { name: 'Tomás Ibarra', code: 'IBA', number: 4, skill: 0.996 },
    { name: 'Camila Rivas', code: 'RIV', number: 81, skill: 0.987 },
  ] },
  { name: 'Cóndor F1', color: '#1f3aa8', accent: '#ff2d55', pace: 0.995, drivers: [
    { name: 'Facundo Medina', code: 'MED', number: 1, skill: 0.997 },
    { name: 'Emilia Duarte', code: 'DUA', number: 22, skill: 0.982 },
  ] },
  { name: 'Plata Motorsport', color: '#c3c9cf', accent: '#00d2be', pace: 0.992, drivers: [
    { name: 'Joaquín Aguirre', code: 'AGU', number: 63, skill: 0.99 },
    { name: 'Agustina Roldán', code: 'ROL', number: 12, skill: 0.985 },
  ] },
  { name: 'Mate Verde', color: '#00704a', accent: '#c8ff00', pace: 0.988, drivers: [
    { name: 'Nicolás Paz', code: 'PAZ', number: 14, skill: 0.986 },
    { name: 'Sofía Luna', code: 'LUN', number: 18, skill: 0.984 },
  ] },
  { name: 'Ceibo Racing', color: '#ff4f9a', accent: '#ffffff', pace: 0.986, drivers: [
    { name: 'Bruno Castro', code: 'CAS', number: 10, skill: 0.988 },
    { name: 'Julieta Vela', code: 'VEL', number: 31, skill: 0.983 },
  ] },
  { name: 'Glaciar GP', color: '#2ad4e0', accent: '#0a2a5c', pace: 0.984, drivers: [
    { name: 'Mateo Godoy', code: 'GOD', number: 23, skill: 0.985 },
    { name: 'Pilar Acosta', code: 'ACO', number: 2, skill: 0.982 },
  ] },
  { name: 'Toro Negro', color: '#23233a', accent: '#ffcc00', pace: 0.982, drivers: [
    { name: 'Diego Benítez', code: 'BEN', number: 27, skill: 0.986 },
    { name: 'Milagros Ojeda', code: 'OJE', number: 20, skill: 0.98 },
  ] },
  { name: 'Malbec Team', color: '#7a1f3d', accent: '#e8c27a', pace: 0.98, drivers: [
    { name: 'Lautaro Funes', code: 'FUN', number: 77, skill: 0.984 },
    { name: 'Ignacio Ponce', code: 'PON', number: 24, skill: 0.981 },
  ] },
];

// Lista plana de pilotos intercalando escuderías para que con pocos
// autos haya variedad de colores.
export function pickDrivers(count) {
  const out = [];
  for (let seat = 0; seat < 2; seat++) {
    for (const team of TEAMS) {
      out.push({ ...team.drivers[seat], team });
      if (out.length === count) return out;
    }
  }
  return out;
}
