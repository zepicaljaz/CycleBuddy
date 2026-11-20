import { BRAND_IDS, type BikeBrand } from '../world/bikes';
import type { RiderColors } from '../world/riders';

export const NATIONS: { code: string; first: string[]; last: string[] }[] = [
  { code: 'SLO', first: ['Luka', 'Matej', 'Jan', 'Tadej', 'Primoz', 'Anze', 'Domen', 'Ziga'], last: ['Novak', 'Kranjc', 'Horvat', 'Zupan', 'Mohoric', 'Bizjak', 'Kos', 'Golob'] },
  { code: 'ITA', first: ['Marco', 'Luca', 'Davide', 'Filippo', 'Giulio', 'Matteo'], last: ['Bianchi', 'Rossi', 'Ciccone', 'Moretti', 'Ferrari', 'Conti'] },
  { code: 'FRA', first: ['Julien', 'Romain', 'Thibaut', 'Lenny', 'Pierre', 'Hugo'], last: ['Moreau', 'Martin', 'Bernard', 'Durand', 'Lefevre', 'Roux'] },
  { code: 'ESP', first: ['Carlos', 'Juan', 'Enric', 'Pello', 'Mikel', 'Alejandro'], last: ['Garcia', 'Rodriguez', 'Soler', 'Landa', 'Ruiz', 'Navarro'] },
  { code: 'BEL', first: ['Remco', 'Wout', 'Jasper', 'Tim', 'Arnaud', 'Maxim'], last: ['Peeters', 'Janssens', 'Maes', 'Claes', 'Wouters', 'Goossens'] },
  { code: 'NED', first: ['Dylan', 'Bauke', 'Thymen', 'Wilco', 'Sam', 'Lars'], last: ['de Vries', 'Bakker', 'Visser', 'Smit', 'Mulder', 'Dekker'] },
  { code: 'GBR', first: ['Tom', 'Adam', 'Oscar', 'Simon', 'Ethan', 'James'], last: ['Pidcock', 'Hayter', 'Walker', 'Clarke', 'Hughes', 'Turner'] },
  { code: 'DEN', first: ['Jonas', 'Mads', 'Mattias', 'Magnus', 'Kasper'], last: ['Pedersen', 'Hansen', 'Skjelmose', 'Cort', 'Nielsen'] },
  { code: 'COL', first: ['Egan', 'Nairo', 'Santiago', 'Daniel', 'Sergio'], last: ['Quintana', 'Lopez', 'Buitrago', 'Martinez', 'Higuita'] },
  { code: 'AUT', first: ['Felix', 'Patrick', 'Lukas', 'Michael', 'Marco'], last: ['Gall', 'Konrad', 'Mayrhofer', 'Haller', 'Brandle'] },
  { code: 'SUI', first: ['Marc', 'Stefan', 'Mauro', 'Gino', 'Silvan'], last: ['Hirschi', 'Kung', 'Schmid', 'Mader', 'Dillier'] },
  { code: 'NOR', first: ['Tobias', 'Andreas', 'Søren', 'Markus', 'Even'], last: ['Johannessen', 'Leknessund', 'Hoelgaard', 'Halvorsen', 'Kristoff'] },
  { code: 'GER', first: ['Florian', 'Max', 'Emanuel', 'Nils', 'Jonas'], last: ['Lipowitz', 'Schachmann', 'Buchmann', 'Politt', 'Koch'] },
  { code: 'USA', first: ['Sepp', 'Neilson', 'Matteo', 'Brandon', 'Quinn'], last: ['Kuss', 'Powless', 'Jorgenson', 'McNulty', 'Simmons'] },
  { code: 'AUS', first: ['Jai', 'Ben', 'Michael', 'Luke', 'Lucas'], last: ['Hindley', "O'Connor", 'Storer', 'Plapp', 'Matthews'] },
  { code: 'CRO', first: ['Matija', 'Josip', 'Fran', 'Ivan'], last: ['Kovac', 'Babic', 'Juric', 'Peric'] },
];

export interface TeamKit {
  name: string;
  jersey: string;
  accent: string;
  shorts: string;
  helmet: string;
  frame: string;
  /** Defaults to a brand picked from the team name. */
  bike?: BikeBrand;
}

export const TEAMS: TeamKit[] = [
  { name: 'Alpine Velo', jersey: '#e94e1b', accent: '#ffffff', shorts: '#1d1d1f', helmet: '#e94e1b', frame: '#1d1d1f', bike: 'falcora' },
  { name: 'Blue Summit', jersey: '#1f5fbf', accent: '#ffd23f', shorts: '#14213d', helmet: '#ffffff', frame: '#1f5fbf', bike: 'montvar' },
  { name: 'Verde Racing', jersey: '#2fa84f', accent: '#ffffff', shorts: '#1d1d1f', helmet: '#2fa84f', frame: '#ffffff', bike: 'corsano' },
  { name: 'Sole Cycling', jersey: '#ffcd1f', accent: '#1d1d1f', shorts: '#1d1d1f', helmet: '#1d1d1f', frame: '#ffcd1f', bike: 'nordvik' },
  { name: 'Nordic Pro', jersey: '#ffffff', accent: '#c8102e', shorts: '#c8102e', helmet: '#ffffff', frame: '#c8102e', bike: 'zentra' },
  { name: 'Black Peak', jersey: '#24262b', accent: '#ff5fa2', shorts: '#24262b', helmet: '#ff5fa2', frame: '#24262b', bike: 'falcora' },
  { name: 'Lilac Riders', jersey: '#8a5cd6', accent: '#ffffff', shorts: '#2b2140', helmet: '#8a5cd6', frame: '#ffffff', bike: 'corsano' },
  { name: 'Teal Climb', jersey: '#11a3b5', accent: '#0b3c49', shorts: '#0b3c49', helmet: '#ffffff', frame: '#0b3c49', bike: 'montvar' },
  { name: 'Orange Wave', jersey: '#ff8a1f', accent: '#1f3b73', shorts: '#1f3b73', helmet: '#1f3b73', frame: '#ff8a1f', bike: 'zentra' },
  { name: 'Crimson Col', jersey: '#a31621', accent: '#f2c14e', shorts: '#2a0a0e', helmet: '#f2c14e', frame: '#a31621', bike: 'nordvik' },
  { name: 'Sky Line', jersey: '#7cc6fe', accent: '#1d1d1f', shorts: '#1d1d1f', helmet: '#7cc6fe', frame: '#ffffff', bike: 'montvar' },
  { name: 'Lime Rocket', jersey: '#b5e61d', accent: '#1d1d1f', shorts: '#1d1d1f', helmet: '#b5e61d', frame: '#1d1d1f', bike: 'zentra' },
];

const SKINS = ['#f1c7a5', '#e0b48f', '#c99470', '#a8724f', '#7d5236', '#f5d5bd'];

/** Every rider on a team rides the same brand. */
function teamBike(name: string): BikeBrand {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return BRAND_IDS[h % BRAND_IDS.length];
}

export function teamColors(team: TeamKit, rng: () => number): RiderColors {
  return {
    jersey: team.jersey,
    jerseyAccent: team.accent,
    shorts: team.shorts,
    helmet: team.helmet,
    frame: team.frame,
    wheels: rng() < 0.5 ? '#1c1d22' : '#3a3d44',
    shoes: rng() < 0.6 ? '#f2f2f2' : '#1c1d22',
    skin: SKINS[Math.floor(rng() * SKINS.length)],
    bike: team.bike ?? teamBike(team.name),
  };
}
