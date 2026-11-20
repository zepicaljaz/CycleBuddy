import type { BikeBrand } from '../world/bikes';
import type { RiderColors } from '../world/riders';
import type { Division, Focus } from './types';

export interface TeamDef {
  id: string;
  name: string;
  division: Division;
  focus: Focus;
  nation: string;
  kit: { jersey: string; accent: string; shorts: string; helmet: string; frame: string; bike: BikeBrand };
  sponsors: string;
}

/**
 * Real men's structure this is built from: 18 UCI WorldTeams, rosters of 27–30
 * (most start near 28); about 17 UCI ProTeams, rosters usually 20–28; and roughly
 * 180 Continental teams of about 10–16 riders. CYB fields every World and Pro team.
 * Continental is the 20 teams you can join and race all year, 14 riders each.
 */
export const WORLD_TEAMS = 22;
export const PRO_TEAMS = 20;
export const CONTINENTAL_TEAMS = 20;
export const ROSTER_SIZE: Record<Division, number> = { world: 28, pro: 23, continental: 14 };

export const DIVISION_BLURB =
  'World Tour is 22 teams. A World Tour start is 8 riders from each. Pro is 20 teams, 7 riders on the start line. Continental, where you start, is 20 teams of 14, and a Continental start takes 15 of them with 7 riders each.';

const k = (
  id: string, name: string, division: Division, focus: Focus, nation: string,
  jersey: string, accent: string, shorts: string, helmet: string, frame: string, bike: BikeBrand, sponsors: string,
): TeamDef => ({ id, name, division, focus, nation, kit: { jersey, accent, shorts, helmet, frame, bike }, sponsors });

export const TEAMS: TeamDef[] = [
  k('atlas', 'Atlas Emirates', 'world', 'stage', 'SLO', '#f4f4f4', '#e10600', '#16171a', '#f4f4f4', '#111111', 'falcora', 'Atlas Air · Novara Steel'),
  k('hive', 'Yellow Hive', 'world', 'stage', 'DEN', '#ffe100', '#111111', '#111111', '#ffe100', '#111111', 'montvar', 'Hive Bank · Lease Line'),
  k('bullion', 'Red Bullion', 'world', 'stage', 'BEL', '#1a2744', '#e10600', '#10141c', '#e10600', '#1a2744', 'nordvik', 'Bullion · Red Rail'),
  k('marine', 'Marine Deca', 'world', 'stage', 'FRA', '#0b4ea2', '#ffffff', '#0a2e66', '#0b4ea2', '#ffffff', 'corsano', 'Marine Deck · Deca Shop'),
  k('northfuel', 'North Fuel', 'world', 'stage', 'NOR', '#111111', '#f5c400', '#111111', '#f5c400', '#111111', 'zentra', 'North Fuel · Fjord Oil'),
  k('crimson', 'Crimson Trek', 'world', 'sprint', 'USA', '#ee2a2a', '#ffd100', '#1b1f27', '#ffd100', '#1b1f27', 'falcora', 'Crimson · Trek Rail'),
  k('pinkedu', 'Pink Education', 'world', 'classics', 'COL', '#f4a3c7', '#1b1f27', '#1b1f27', '#f4a3c7', '#1b1f27', 'montvar', 'Pink Fund · Campus'),
  k('astera', 'Azure Astera', 'world', 'stage', 'ESP', '#3ec3ff', '#0a3d66', '#0a3d66', '#3ec3ff', '#0a3d66', 'corsano', 'Astera · Steppe Air'),
  k('movara', 'Movara', 'world', 'stage', 'ESP', '#0a4ea3', '#7ec8e3', '#062a5c', '#0a4ea3', '#0a4ea3', 'nordvik', 'Movara · Blue Phone'),
  k('ivory', 'Ivory Hunt', 'world', 'classics', 'BEL', '#f2f2f2', '#222222', '#1b1f27', '#222222', '#f2f2f2', 'zentra', 'Ivory · Hunt Coffee'),
  k('jayline', 'Jayline', 'world', 'stage', 'AUS', '#f7f7f7', '#0b7a3b', '#123524', '#0b7a3b', '#f7f7f7', 'falcora', 'Jayline · Green Ore'),
  k('grenat', 'Grenat', 'world', 'stage', 'GBR', '#c8102e', '#111111', '#111111', '#c8102e', '#111111', 'montvar', 'Grenat · Black Salt'),
  k('loire', 'Bleu Loire', 'world', 'stage', 'FRA', '#ffffff', '#0033a0', '#0033a0', '#0033a0', '#ffffff', 'corsano', 'Loire Mutual · Blue Grain'),
  k('cobalt', 'Cobalt Step', 'world', 'classics', 'BEL', '#123a8f', '#ffffff', '#0c245c', '#123a8f', '#ffffff', 'nordvik', 'Cobalt · Quick Floor'),
  k('pearl', 'Pearl Victors', 'world', 'stage', 'SLO', '#d0121a', '#f2c14e', '#2a0a0e', '#d0121a', '#1a1a1a', 'zentra', 'Pearl · Victor Gold'),
  k('goldhour', 'Gold Hour', 'world', 'stage', 'SUI', '#1a1a1a', '#c4a35a', '#111111', '#1a1a1a', '#c4a35a', 'falcora', 'Gold Hour · Watch Co'),
  k('creditrouge', 'Credit Rouge', 'world', 'sprint', 'FRA', '#e10600', '#ffffff', '#ffffff', '#e10600', '#1b1f27', 'montvar', 'Credit Rouge · Bank'),
  k('lottosun', 'Lotto Sun', 'world', 'sprint', 'BEL', '#e23b2f', '#f2c14e', '#2a1210', '#e23b2f', '#1b1f27', 'corsano', 'Lotto Sun · Ticket'),
  k('nordicjet', 'Nordic Jet', 'world', 'stage', 'NOR', '#00205b', '#ba0c2f', '#ffffff', '#ba0c2f', '#00205b', 'nordvik', 'Nordic Jet · Fjord'),
  k('iberiasun', 'Iberia Sun', 'world', 'sprint', 'ESP', '#f4c400', '#c60b1e', '#1b1f27', '#c60b1e', '#f4c400', 'zentra', 'Iberia Sun · Orange'),
  k('alpinepost', 'Alpine Post', 'world', 'classics', 'SUI', '#d52b1e', '#ffffff', '#d52b1e', '#ffffff', '#111111', 'falcora', 'Alpine Post · Stamp'),
  k('dutchwind', 'Dutch Wind', 'world', 'classics', 'NED', '#ff7f00', '#21468b', '#21468b', '#ff7f00', '#ffffff', 'montvar', 'Dutch Wind · Dyke'),

  k('oakfuel', 'Oak Fuel', 'pro', 'stage', 'NOR', '#111111', '#f5c400', '#1b1f27', '#f5c400', '#222222', 'nordvik', 'Oak Fuel · Pine'),
  k('amber', 'Total Amber', 'pro', 'sprint', 'FRA', '#ffe14a', '#e10600', '#1b1f27', '#ffe14a', '#e10600', 'zentra', 'Amber Grid · Total'),
  k('malt', 'Flanders Malt', 'pro', 'classics', 'BEL', '#1f4e9c', '#f2c14e', '#0e2248', '#1f4e9c', '#f2c14e', 'falcora', 'Malt · Barley'),
  k('burghill', 'Burg Hill', 'pro', 'stage', 'ESP', '#ffffff', '#c8102e', '#1b1f27', '#c8102e', '#ffffff', 'montvar', 'Burg Hill · Castle'),
  k('campo', 'Caja Campo', 'pro', 'stage', 'ESP', '#1f8a4c', '#ffffff', '#143d28', '#1f8a4c', '#ffffff', 'corsano', 'Campo · Rural Bank'),
  k('eusko', 'Eusko Peak', 'pro', 'stage', 'ESP', '#f28c28', '#111111', '#1b1f27', '#f28c28', '#111111', 'nordvik', 'Eusko · Peak Oil'),
  k('levant', 'Levant Pro', 'pro', 'classics', 'ISR', '#ffffff', '#1a4f8b', '#1a4f8b', '#ffffff', '#1a4f8b', 'zentra', 'Levant · Sea Salt'),
  k('kern', 'Kern Lab', 'pro', 'stage', 'ESP', '#163a5f', '#f28c28', '#0e2438', '#163a5f', '#f28c28', 'falcora', 'Kern · Lab Coat'),
  k('polsun', 'Pol Sun', 'pro', 'sprint', 'ITA', '#f2d024', '#111111', '#111111', '#111111', '#f2d024', 'montvar', 'Pol Sun · Yellow Page'),
  k('soltech', 'Solution Tech', 'pro', 'stage', 'ITA', '#1463b8', '#ffffff', '#0c3a6e', '#1463b8', '#ffffff', 'corsano', 'Solution · Circuit'),
  k('wagner', 'Wagner Glass', 'pro', 'classics', 'FRA', '#0e7a45', '#ffffff', '#0a3d24', '#0e7a45', '#111111', 'nordvik', 'Wagner · Green Glass'),
  k('qfive', 'Q-Five', 'pro', 'stage', 'SUI', '#24262b', '#ffffff', '#16171a', '#ffffff', '#c81d25', 'zentra', 'Q-Five · Alpine Data'),
  k('novomed', 'Novo Med', 'pro', 'stage', 'DEN', '#ffffff', '#0a4ea3', '#0a4ea3', '#ffffff', '#0a4ea3', 'falcora', 'Novo Med · Clinic'),
  k('westmarine', 'West Marine', 'pro', 'sprint', 'FRA', '#111111', '#e85aad', '#1b1f27', '#e85aad', '#111111', 'montvar', 'West Marine · Sail'),
  k('market', 'Market Green', 'pro', 'classics', 'FRA', '#14804a', '#ffffff', '#0e3d24', '#14804a', '#111111', 'corsano', 'Market · Green Basket'),
  k('postnl', 'Post Canal', 'pro', 'sprint', 'NED', '#ff8a1f', '#1f3b73', '#1f3b73', '#1f3b73', '#ff8a1f', 'nordvik', 'Post Canal · Parcel'),
  k('bardia', 'Bardia', 'pro', 'stage', 'ITA', '#0b6b4a', '#f2f2f2', '#083828', '#0b6b4a', '#f2f2f2', 'zentra', 'Bardia · Olive Oil'),
  k('galpeak', 'Gal Peak', 'pro', 'stage', 'ESP', '#009b48', '#ffffff', '#0c3d22', '#009b48', '#da121a', 'falcora', 'Gal Peak · Granite'),
  k('tuscanoil', 'Tuscan Oil', 'pro', 'classics', 'ITA', '#c4a35a', '#6b1d2a', '#6b1d2a', '#c4a35a', '#f4f4f4', 'montvar', 'Tuscan Oil · Press'),
  k('britton', 'Brit Ton', 'pro', 'sprint', 'GBR', '#012169', '#c8102e', '#ffffff', '#012169', '#c8102e', 'corsano', 'Brit Ton · Harbour'),

  k('alpendev', 'Alpen Dev', 'continental', 'stage', 'AUT', '#e10600', '#ffffff', '#1b1f27', '#e10600', '#ffffff', 'falcora', 'Alpen · Dev Fund'),
  k('coastkick', 'Coast Kick', 'continental', 'sprint', 'NED', '#ff7f2a', '#1b1f27', '#1b1f27', '#ff7f2a', '#1b1f27', 'montvar', 'Coast · Kick Drum'),
  k('hopeflan', 'Hope Flanders', 'continental', 'classics', 'BEL', '#f2c14e', '#1a2744', '#1a2744', '#f2c14e', '#1a2744', 'corsano', 'Hope · Malt Shop'),
  k('pyrenex', 'Pyrenex', 'continental', 'stage', 'FRA', '#c8102e', '#ffd100', '#1b1f27', '#ffd100', '#c8102e', 'nordvik', 'Pyrenex · Wool'),
  k('doloyouth', 'Dolo Youth', 'continental', 'stage', 'ITA', '#7ec8e3', '#0a3d66', '#0a3d66', '#7ec8e3', '#ffffff', 'zentra', 'Dolo · Youth Club'),
  k('iberiacont', 'Iberia Cont', 'continental', 'stage', 'ESP', '#e23b2f', '#f4f4f4', '#2a1210', '#e23b2f', '#f4f4f4', 'falcora', 'Iberia · Tile'),
  k('britishhope', 'British Hope', 'continental', 'classics', 'GBR', '#012169', '#ffffff', '#012169', '#c8102e', '#ffffff', 'montvar', 'Hope · Harbour'),
  k('nordiccont', 'Nordic Cont', 'continental', 'stage', 'NOR', '#ba0c2f', '#ffffff', '#00205b', '#ffffff', '#00205b', 'corsano', 'Nordic · Timber'),
  k('southwave', 'South Wave', 'continental', 'sprint', 'AUS', '#00843d', '#ffcd00', '#012169', '#ffcd00', '#00843d', 'nordvik', 'South Wave · Reef'),
  k('liberty', 'Liberty', 'continental', 'sprint', 'USA', '#3c3b6e', '#ffffff', '#b22234', '#ffffff', '#3c3b6e', 'zentra', 'Liberty · Bell'),
  k('slorising', 'Slovene Rising', 'continental', 'stage', 'SLO', '#ffffff', '#005da4', '#ed1c24', '#005da4', '#ffffff', 'falcora', 'Rising · Lake Co'),
  k('andescoffee', 'Andes Coffee', 'continental', 'stage', 'COL', '#fcd116', '#003893', '#ce1126', '#fcd116', '#003893', 'montvar', 'Andes · Coffee'),
  k('rheinsprint', 'Rhein Sprint', 'continental', 'sprint', 'GER', '#000000', '#dd0000', '#ffcc00', '#dd0000', '#000000', 'corsano', 'Rhein · Spark'),
  k('alpineclock', 'Alpine Clock', 'continental', 'stage', 'SUI', '#d52b1e', '#ffffff', '#d52b1e', '#ffffff', '#d52b1e', 'nordvik', 'Clock · Alpine'),
  k('portoclimb', 'Porto Climb', 'continental', 'stage', 'POR', '#006600', '#ffcc00', '#ff0000', '#ffcc00', '#006600', 'zentra', 'Porto · Tile'),
  k('danishhammer', 'Danish Hammer', 'continental', 'sprint', 'DEN', '#c60c30', '#ffffff', '#c60c30', '#ffffff', '#c60c30', 'falcora', 'Hammer · Bakery'),
  k('walloon', 'Walloon Punch', 'continental', 'classics', 'BEL', '#ffd100', '#000000', '#ed1c24', '#000000', '#ffd100', 'montvar', 'Walloon · Punch'),
  k('basquehill', 'Basque Hill', 'continental', 'classics', 'ESP', '#da121a', '#009b48', '#ffffff', '#da121a', '#009b48', 'corsano', 'Basque · Hill Farm'),
  k('irishsea', 'Irish Sea', 'continental', 'classics', 'IRL', '#169b62', '#ffffff', '#ff883e', '#ffffff', '#169b62', 'nordvik', 'Irish Sea · Wool'),
  k('bohemia', 'Bohemia', 'continental', 'stage', 'CZE', '#11457e', '#d7141a', '#ffffff', '#11457e', '#d7141a', 'zentra', 'Bohemia · Glass'),
];

export function teamById(id: string): TeamDef | undefined {
  return TEAMS.find((t) => t.id === id);
}

/** Three-letter team code for results. Atlas Emirates becomes AEM. */
export function teamCode(nameOrId: string): string {
  const team = teamById(nameOrId);
  const name = team?.name ?? nameOrId;
  const words = name.split(/[\s-]+/).map((word) => word.replace(/[^A-Za-z]/g, '')).filter((word) => word.length > 0);
  if (words.length >= 2) return (words[0].slice(0, 1) + words[1].slice(0, 2)).toUpperCase();
  return (words[0] ?? 'TM').slice(0, 3).toUpperCase();
}

export function teamsIn(division: Division): TeamDef[] {
  return TEAMS.filter((t) => t.division === division);
}

export function teamKit(team: TeamDef, skin = '#e0b48f'): RiderColors {
  return {
    jersey: team.kit.jersey,
    jerseyAccent: team.kit.accent,
    shorts: team.kit.shorts,
    helmet: team.kit.helmet,
    frame: team.kit.frame,
    wheels: '#2a2d33',
    shoes: '#f4f4f4',
    skin,
    bike: team.kit.bike,
  };
}

export const FOCUS_LABEL: Record<Focus, string> = {
  sprint: 'Sprinters',
  classics: 'Classics',
  stage: 'Stage races',
};

export const DIVISION_LABEL: Record<Division, string> = {
  world: 'World Tour',
  pro: 'Pro',
  continental: 'Continental',
};
