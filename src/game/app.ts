import { brandLogo } from '../brand';
import { bluetoothSupported, DeviceManager, type DeviceStatus } from '../ble/devices';
import { ROUTES, getRouteDef } from '../routes/definitions';
import { REAL_RIDE, RIDE_REGIONS, rideRegion } from '../routes/regions';
import { getRoute, riddenClimbs, routeStarts, type Climb, type Route } from '../routes/route';
import { loadRouteTerrain } from '../routes/real/terrain';
import { preloadPropAssets } from '../world/propAssets';
import type { Difficulty, RouteDef } from '../routes/types';
import { deleteAccountRide, publishRide, syncAccountRides } from '../storage/accountRides';
import { clearLocalAccountData } from '../storage/localOwner';
import { exportBackup, importBackup } from '../storage/backup';
import { downloadBytes, rideFileName } from '../storage/download';
import { IndexedDbStorage } from '../storage/indexedDb';
import type { AnalyticsPage, AnalyticsState, VolumeMetric } from '../analytics/view';
import type { AnalyticsRange, PowerData } from '../analytics/metrics';
import type { RideKind, RideSortKey } from '../analytics/model';
import type { ClimbEffort, Profile, RideCamera, RideSample, RideSummary, StorageProvider } from '../storage/types';
import { formatDuration, uuid } from '../util/math';
import { ATMOSPHERES, type TimeOfDay } from '../world/atmosphere';
import { BRANDS, type BikeBrand } from '../world/bikes';
import { fetchAccountProfile, mergeAccountProfile, pushAccountProfile, riderRecordKey } from './accountProfile';
import { coinWord, coinsForDistance, settleEquipment, shopCost, takeFromShop, wheelLabel, type ShopKind } from './coins';
import { Graphics, QUALITY, type GraphicsQuality } from '../world/graphics';
import { DEFAULT_COLORS, type RiderColors, type RiderPose } from '../world/riders';
import type { RoadWriting } from '../world/climbs';
import { CAMERA_LABEL, RIDE_CAMERAS, World, type CameraMode } from '../world/world';
import type { LaneUser } from '../world/traffic';
import { $, $$, esc, toast } from '../ui/dom';
import { HELP_SECTIONS } from '../ui/helpContent';
import { Hud } from '../ui/hud';
import { drawClimbCard, drawLoadProfile, drawRouteCard, FREE_RIDE_RISE, primeUnder } from '../ui/profileChart';
import { hidePlayBoot } from './playBoot';
import { activateWorkout, FTP_TEST_PLAN, GROUPS, nextWorkout, planById, planStats, PLANS, workoutPeakWatts, type PlanGroup, type TrainingPlan } from '../training/plans';
import type { ActiveWorkout, Workout } from '../training/workout';
import { compareFtpTests, formatFtpDate, ftpChangeLabel, ftpInRange, ftpTestsFromRides, ftpTrend, type ComparedFtpTest } from '../training/ftp';
import { progressFromRides, workoutKey } from '../training/progress';
import { barsHtml, expandBlocks, formatSession, prescribedLoad } from '../training/workout';
import { estimateLap, estimateTime } from './estimates';
import { RideSession, type SessionMode } from './session';
import { formatDate, raceById, raceDays, stageWindow } from '../career/calendar';
import { startMateCount } from '../career/squad';
import { teamCode } from '../career/teams';
import { calendarChipClass, careerHtml, seasonUpdateHtml } from '../career/panel';
import type { SeasonUpdate } from '../career/progress';
import { Career, stagePrimes, type CareerLaunch } from '../career/season';
import type { RaceClassifications, StageResultRow } from '../career/season';
import { summarizeSamples } from './recorder';
import { sound } from '../audio/sound';
import { REAL_CLIMB_MAP, REAL_CLIMBS } from '../routes/real/data';
import type { RealClimb } from '../routes/real/types';
import { allTracksReady, ensureAllTracks, ensureTrack, realClimbRoute, realRoadClimbs, realRoadDifficulty, realRoadStats, trackReady } from '../routes/real/build';
import { drawRoadbook } from '../ui/roadbook';
import { HOME_KEYS, homeHtml } from './homeView';
import { bindProRace, loadChoice, proRaceHtml } from './proRaceView';
import { launchQuickRace } from './quickRace';
import { RoadAhead } from '../ui/roadAhead';
import { RiderTag, tagLines, type TagMode } from '../ui/riderTag';
import { pickRider } from '../world/riderPick';
import '../ui/menus.css';

type Screen = 'home' | 'free' | 'race' | 'pro' | 'plans' | 'plan' | 'train-route' | 'garage' | 'history' | 'settings' | 'help' | 'career';
type PlanFilter = PlanGroup | 'all';

/** Most ride time one frame may catch up after a stall. */
const FRAME_CATCH_UP_SEC = 5;
/**
 * Most ride time the hidden-tab timer may catch up at once. Chrome can slow
 * background timers to once a minute after a few minutes, so this is generous.
 */
const BACKGROUND_CATCH_UP_SEC = 75;

const DIFFICULTY_LABEL: Record<Difficulty, string> = { flat: 'Flat', hilly: 'Hilly', mountain: 'Mountain', epic: 'Epic' };

function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value);
  return value.replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`);
}
const DIFFICULTY_RANK: Record<Difficulty, number> = { flat: 0, hilly: 1, mountain: 2, epic: 3 };

type FreeSort = 'distance' | 'climbing' | 'type';
/** One Free ride card; `route` is null while a real road's track is still being fetched. */
type FreeRow = { id: string; name: string; description: string; difficulty: Difficulty; length: number; ascent: number; route: Route | null };
const FREE_SORTS: { id: FreeSort; label: string }[] = [
  { id: 'distance', label: 'Distance' },
  { id: 'climbing', label: 'Climbing' },
  { id: 'type', label: 'Type' },
];

type ClimbSort = 'length' | 'grade' | 'elevation' | 'route';
const CLIMB_SORTS: { id: ClimbSort; label: string }[] = [
  { id: 'length', label: 'Length' },
  { id: 'grade', label: 'Avg. grade' },
  { id: 'elevation', label: 'Elevation' },
  { id: 'route', label: 'Route' },
];

const DEVICE_STATE: Record<string, string> = {
  disconnected: 'Not connected',
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting…',
};

/**
 * Trainer and heart rate as two read-outs with their actions beside them. The virtual trainer
 * says how to drive it instead of repeating its name.
 */
function devicesHtml(s: DeviceStatus, virtual: boolean): string {
  const trainer = s.trainer !== 'connected'
    ? DEVICE_STATE[s.trainer] ?? s.trainer
    : virtual ? 'Virtual · arrow keys' : `${s.trainerName}${s.trainerProtocol ? ` · ${s.trainerProtocol}` : ''}`;
  const hr = s.hr === 'connected' ? s.hrName || 'Connected' : DEVICE_STATE[s.hr] ?? s.hr;
  const pair = s.trainer === 'connected' && !virtual ? 'Re-pair' : 'Pair';
  return `
    <div class="dev ${s.trainer}">
      <i aria-hidden="true"></i>
      <span class="dev-read"><small>Trainer</small><b>${esc(trainer)}</b></span>
      <span class="dev-acts">
        <button type="button" data-act="connect-trainer" title="Any Bluetooth smart trainer (FTMS). Older Tacx trainers connect too.">${pair}</button>
        ${virtual && s.trainer === 'connected' ? '' : '<button type="button" data-act="virtual" title="Ride without a trainer: arrow keys set your power.">Virtual</button>'}
      </span>
    </div>
    <div class="dev ${s.hr}">
      <i aria-hidden="true"></i>
      <span class="dev-read"><small>Heart rate</small><b>${esc(hr)}</b></span>
      <span class="dev-acts"><button type="button" data-act="connect-hr">${s.hr === 'connected' ? 'Re-pair' : 'Pair'}</button></span>
    </div>`;
}

/** The Analytics page (charts, calendar, segment analyzer) loads when it is first opened. */
type AnalyticsModule = typeof import('../analytics/view') & typeof import('../analytics/model');
let analyticsModule: AnalyticsModule | null = null;
async function loadAnalytics(): Promise<AnalyticsModule> {
  if (!analyticsModule) {
    const [view, model] = await Promise.all([import('../analytics/view'), import('../analytics/model')]);
    analyticsModule = { ...view, ...model };
  }
  return analyticsModule;
}
/** Only called once the page has painted, which loads the module first. */
function an(): AnalyticsModule {
  if (!analyticsModule) throw new Error('Analytics is not loaded yet');
  return analyticsModule;
}

/** FIT export/import (@garmin/fitsdk, ~600 kB) loads on first use, not with the app. */
const loadFit = () => import('../storage/fit');

/** A FIT file for the ride, or null if the encoder could not load. The ride is still saved; the FIT is rebuilt from samples on download. */
async function encodeFitLazy(summary: RideSummary, samples: RideSample[]): Promise<Uint8Array | null> {
  try {
    return (await loadFit()).encodeFit(summary, samples);
  } catch (err) {
    console.error('Could not build the FIT file', err);
    return null;
  }
}

function climbSortHint(id: ClimbSort, desc: boolean): string {
  if (id === 'length') return desc ? 'Longest first' : 'Shortest first';
  if (id === 'grade') return desc ? 'Steepest first' : 'Shallowest first';
  if (id === 'elevation') return desc ? 'Most elevation first' : 'Least elevation first';
  return desc ? 'Z to A' : 'A to Z';
}

function freeSortHint(id: FreeSort, desc: boolean): string {
  if (id === 'distance') return desc ? 'Longest first' : 'Shortest first';
  if (id === 'climbing') return desc ? 'Most climbing first' : 'Least climbing first';
  return desc ? 'Epic first' : 'Flat first';
}

function fold(value: string): string {
  return value.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
}

const COLOR_FIELDS: { key: keyof RiderColors; label: string }[] = [
  { key: 'jersey', label: 'Jersey' },
  { key: 'jerseyAccent', label: 'Jersey stripe' },
  { key: 'shorts', label: 'Shorts' },
  { key: 'helmet', label: 'Helmet' },
  { key: 'frame', label: 'Bike frame' },
  { key: 'wheels', label: 'Wheels' },
  { key: 'shoes', label: 'Shoes' },
  { key: 'skin', label: 'Skin tone' },
];

const KIT_PRESETS: { name: string; colors: Partial<RiderColors> }[] = [
  { name: 'Teal classic', colors: { jersey: '#1fa39a', jerseyAccent: '#ffffff', shorts: '#1b1f27', helmet: '#f4f4f4', frame: '#e2412e', shoes: '#f4f4f4' } },
  { name: 'Polka climber', colors: { jersey: '#ffffff', jerseyAccent: '#d0021b', shorts: '#1b1f27', helmet: '#d0021b', frame: '#ffffff', shoes: '#ffffff' } },
  { name: 'Yellow leader', colors: { jersey: '#ffd200', jerseyAccent: '#1b1f27', shorts: '#1b1f27', helmet: '#ffd200', frame: '#1b1f27', shoes: '#1b1f27' } },
  { name: 'Slovenia', colors: { jersey: '#ffffff', jerseyAccent: '#005ce6', shorts: '#d40000', helmet: '#005ce6', frame: '#ffffff', shoes: '#ffffff' } },
  { name: 'Stealth', colors: { jersey: '#24262b', jerseyAccent: '#ff5f1f', shorts: '#16171a', helmet: '#24262b', frame: '#24262b', wheels: '#16171a', shoes: '#24262b' } },
  { name: 'Pink panther', colors: { jersey: '#ff6fae', jerseyAccent: '#1b1f27', shorts: '#1b1f27', helmet: '#ffffff', frame: '#ff6fae', shoes: '#ffffff' } },
];

/** A saved look that is still the old Falcora starter kit has not chosen a bike. */
function withCurrentDefaultBike(profile: Profile, saved: Profile | null): Profile {
  if (saved?.colors?.bike !== 'falcora') return profile;
  const previous = { ...DEFAULT_COLORS, bike: 'falcora' as const };
  const untouched = (Object.keys(previous) as (keyof RiderColors)[]).every((key) => key === 'wheelBrand' || saved.colors[key] === previous[key]);
  return untouched ? { ...profile, colors: { ...profile.colors, bike: 'montvar' } } : profile;
}

function defaultProfile(): Profile {
  const now = new Date().toISOString();
  return {
    id: 'me',
    name: '',
    weightKg: 72,
    ftp: 230,
    difficulty: 50,
    colors: { ...DEFAULT_COLORS },
    coins: 0,
    ownedFrames: ['montvar'],
    ownedWheels: ['montvar'],
    graphics: 'high',
    timeOfDay: 'golden',
    camera: 'chase',
    map: 'ahead',
    createdAt: now,
    updatedAt: now,
  };
}

function sameRoadWriting(a: RoadWriting | undefined, b: RoadWriting | undefined): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.dir === b.dir && a.from === b.from && a.to === b.to;
}

export class App {
  private storage: StorageProvider = new IndexedDbStorage();
  private devices = new DeviceManager();
  private profile: Profile = defaultProfile();
  private graphics: Graphics | null = null;
  private world: World | null = null;
  private session: RideSession | null = null;
  private hud: Hud;
  private screen: Screen = 'home';
  private ui: HTMLElement;
  private panel: HTMLElement;
  private overlay: HTMLElement;
  private last = performance.now();
  /** Time the ride has been stepped up to. Shared by frames and the hidden-tab timer, so nothing is stepped twice. */
  private sessionClock = performance.now();
  private clockSession: RideSession | null = null;
  private hudTimer = 0;
  private autosaveTimer = 0;
  /** Rider positions handed to traffic each frame. Reused, so a frame does not allocate one object per rider. */
  private laneUsers: LaneUser[] = [];
  private cameraIndex = 0;
  private savedCamera: CameraMode | null = null;
  /** B key and the Brake shortcut are tracked separately, so releasing one does not cancel the other. */
  private brakeKey = false;
  private brakePointer = false;
  /** True while either brake control is held during a ride. */
  private braking = false;
  private lookYaw = 0;
  private lookPitch = 0;
  /** Held key (L): the view swings half a turn to look behind, then returns when it is released. */
  private lookBack = false;
  private draggingLook = false;
  /** Mouse over the 3D view, in canvas pixels. Null when the mouse is elsewhere or the pointer is a finger. */
  private hoverAt: { x: number; y: number; left: number; top: number } | null = null;
  /** The canvas box for the hover tag, cleared on resize. See canvasRect. */
  private canvasBox: { left: number; top: number; width: number; height: number } | null = null;
  /** What syncOverlayPointer last wrote to the canvas. Null forces the next write. */
  private overlayOpen: boolean | null = null;
  private riderTag!: RiderTag;
  private lookPointer = -1;
  /** Clicks before this time are the tail of a press already handled, including after a confirm dialog. */
  private overlayIgnoreUntil = 0;
  private dragX = 0;
  private dragY = 0;
  private dragYaw = 0;
  private dragPitch = 0;
  private selectedRoute = 'alpine';
  private planFilter: PlanFilter = 'all';
  private selectedPlan = 'ftp-builder';
  private selectedWorkout = '';
  private trainRoute = 'riviera';
  /** Landscape open on the training road screen. Empty shows the landscape cards. */
  private trainRegion: string | null = null;
  private doneKeys = new Set<string>();
  private ftpHistory: ComparedFtpTest[] = [];
  private pendingPlan = '';
  private afterRide: Screen = 'home';
  private finishing = false;
  private freeSort: FreeSort = 'climbing';
  /** Climbing opens with the least first. Distance starts with the longest. Type starts with flat. Clicking the active sort reverses it. */
  private freeSortDesc = false;
  /** World chosen on the Free Ride picker. Null shows the world cards. */
  private freeRegion: string | null = null;
  /** Ride it now opens on one climb. Scroll that card into view once, then stop. */
  private scrollFreeSelection = false;
  /** Loops the rider chose to ride backwards. Each loop has its own tick. */
  private reverseRoutes = new Set<string>();
  private climbSort: ClimbSort = 'length';
  /** Biggest first for length, grade and elevation. A to Z for route. */
  private climbSortDesc = true;
  private climbRoute = '';
  private climbQuery = '';
  private selectedClimb = '';
  private startIndex = 0;
  private segmentBests = new Map<string, number>();
  private seenEfforts = 0;
  private aiCount = 75;
  private aiTop = 4.5;
  private aiBottom = 3;
  private buddyOn = false;
  private buddyFlat = 2.8;
  private buddyHill = 3.2;
  private buddyMountain = 3.6;
  private wakeLock: WakeLockSentinel | null = null;
  private career = new Career();
  private pendingLaunch: CareerLaunch | null = null;
  private careerNext = false;
  /** The ride in progress is a one-off pro race: no career result, back to the race page after. */
  private quickRide = false;
  private roadAhead!: RoadAhead;
  private proChoice = loadChoice();
  private careerSheets: RaceClassifications | null = null;
  /** Points, ranking and contract after the stage just ridden. Shown on the race results. */
  private careerSeason: SeasonUpdate | null = null;
  private careerListening = false;
  private garagePose: RiderPose = { x: 0, y: 0, z: 0, tx: 1, tz: 0, grade: 0, crank: 0, wheel: 0, effort: 0, visible: true };
  /** Part the rider is looking at in Equipment. It is not owned until they buy it. */
  private shopFocus: { kind: ShopKind; id: BikeBrand } | null = null;
  private shopPreview: { frame: BikeBrand | null; wheels: BikeBrand | null } = { frame: null, wheels: null };
  private loading = false;
  private analyticsPage: AnalyticsPage = 'dashboard';
  private analyticsSort: RideSortKey = 'date';
  private analyticsSortDesc = true;
  private analyticsKind: RideKind | 'all' = 'all';
  private analyticsYear = new Date().getFullYear();
  private analyticsMonthIndex = new Date().getMonth();
  private analyticsDay: string | null = null;
  private analyticsSegment = 'all';
  private analyticsRouteId = '';
  private analyticsRange: AnalyticsRange = '3m';
  private analyticsVolume: VolumeMetric = 'time';
  /** Best efforts and zone time per ride, keyed by ride id and the FTP they were scored with. */
  private analyticsPower = new Map<string, PowerData>();
  private analyticsPowerLoading = false;
  private analyticsRides: RideSummary[] = [];
  private analyticsEfforts: ClimbEffort[] = [];
  private analyticsSamples = new Map<string, RideSample[]>();

  constructor(private canvas: HTMLCanvasElement, root: HTMLElement) {
    this.ui = root;
    this.ui.innerHTML = `
      <header id="topbar">
        <button id="nav-back" class="top-back" type="button" hidden>Back</button>
        <div class="brand">${brandLogo()}</div>
        <p class="home-rider" id="home-rider" hidden></p>
        <div class="top-actions">
          <div class="devices" id="devices"></div>
          <button class="top-link" id="sign-out" type="button">Sign out</button>
        </div>
      </header>
      <main id="panel"></main>
      <div id="overlay"></div>
      <div id="loading" class="hidden" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" aria-label="Loading the map">
        <div class="load-stage">
          ${brandLogo()}
          <canvas id="load-profile" class="load-profile" aria-hidden="true"></canvas>
        </div>
      </div>
    `;
    this.panel = $('#panel', this.ui);
    this.overlay = $('#overlay', this.ui);
    this.hud = new Hud(this.ui);
    this.riderTag = new RiderTag(this.ui);
    const left = this.ui.querySelector<HTMLElement>('#hud .hud-left');
    this.roadAhead = new RoadAhead(left ?? this.ui);
    const metrics = left?.querySelector('.hud-metrics');
    if (left && metrics) left.insertBefore(left.lastElementChild!, metrics.nextSibling);
    this.hud.bindTools({
      camera: () => this.cycleCamera(),
      time: () => this.cycleTime(),
      map: () => this.cycleMap(),
      reverse: () => this.session?.turnAround(),
      brake: (held) => {
        this.brakePointer = held;
        this.applyBrake();
      },
      lookBack: (held) => {
        if (!held || (this.session && this.world && !this.uiBlocksLook())) this.setLookBack(held);
      },
    });
    this.hud.bindOrders((kind, value) => this.onTeamOrder(kind, value));
    this.hud.show(false);
    this.devices.subscribe((s) => this.renderDevices(s));
    $('#nav-back', this.ui).addEventListener('click', () => this.onNavBack());
    $('#sign-out', this.ui).addEventListener('click', () => {
      void fetch('/api/auth/signout', { method: 'POST' })
        .then(() => clearLocalAccountData(this.storage))
        .catch((err) => console.error(err))
        .finally(() => location.assign('/'));
    });
    window.addEventListener('resize', () => {
      this.canvasBox = null;
      this.world?.resize();
    });
    // The canvas can also change size without a window resize (shown again after display: none).
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(() => {
        this.canvasBox = null;
      }).observe(this.canvas);
    }
    window.addEventListener('keydown', (e) => this.onKey(e));
    window.addEventListener('pointerdown', () => {
      sound.unlock();
      if (!this.session) sound.setMusic('menu');
    }, { capture: true });
    window.addEventListener('keyup', (e) => {
      if (e.key.toLowerCase() === 'b') {
        this.brakeKey = false;
        this.applyBrake();
      }
      if (e.key.toLowerCase() === 'l') this.setLookBack(false);
    });
    window.addEventListener('blur', () => {
      this.releaseBrake();
      this.setLookBack(false);
    });
    // The ride view used to keep the pointer, so a press on the pause dialog
    // never reached the button. While a dialog is open, the press is handled
    // here, before the canvas can take it.
    window.addEventListener('pointerup', (e) => this.onOverlayPointer(e), true);
    this.canvas.addEventListener('pointerdown', (e) => this.onLookDown(e));
    window.addEventListener('pointermove', (e) => {
      this.onLookMove(e);
      this.onHover(e);
    });
    document.addEventListener('pointerleave', () => {
      this.hoverAt = null;
    });
    window.addEventListener('pointerup', (e) => {
      if (e.button !== 0) return;
      this.draggingLook = false;
      if (this.lookPointer === e.pointerId) this.lookPointer = -1;
    });
    window.addEventListener('pointercancel', () => {
      this.draggingLook = false;
      this.lookPointer = -1;
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') {
        this.releaseBrake();
        this.setLookBack(false);
      }
      if (document.visibilityState === 'visible' && this.session) void this.requestWakeLock();
    });
    window.addEventListener('popstate', () => this.onPlayPath());
  }

  async start(): Promise<void> {
    const saved = await this.storage.getProfile();
    this.profile = this.profileFromSave(saved);
    const migratedStarter = saved?.colors?.bike === 'falcora' && this.profile.colors.bike === 'montvar';
    const fromAccount = await this.syncAccountProfile(saved != null);
    this.applySavedView();
    if (migratedStarter && !fromAccount && this.profile.colors.bike === 'montvar') void this.saveProfile();
    if (!this.profile.name) {
      try {
        const res = await fetch('/api/auth/me');
        if (res.ok) {
          const data = (await res.json()) as { user?: { name?: string } };
          const name = data.user?.name?.trim();
          if (name) {
            this.profile.name = name.slice(0, 24);
            void this.saveProfile();
          }
        }
      } catch {
        // The ride still starts if the account server is down.
      }
    }
    this.devices.riderWeightKg = this.profile.weightKg;
    this.career.load();
    await this.forgetLocalRidesOnce();
    // A sync failure (server or database down) must not stop the app from starting.
    const syncing = syncAccountRides(this.storage).catch((err) => console.error('Ride sync failed', err));
    this.selectedRoute = 'alpine';
    this.pendingPlan = this.takePlanLink();
    requestAnimationFrame(() => this.loop());
    // Frames stop in a background tab. Keep the ride clock, the ride file and the
    // workout going once a second until the tab is visible again.
    window.setInterval(() => {
      if (document.hidden) this.advanceSession(performance.now(), BACKGROUND_CATCH_UP_SEC);
    }, 1000);
    let menuReady = false;
    try {
      await this.loadWorld(this.selectedRoute);
      await syncing;
      this.render();
      if (this.onCareerPath()) {
        this.screen = 'career';
        this.render();
      }
      menuReady = true;
      // Warm the FIT encoder while the rider is in the menu, so saving a ride never waits on it.
      window.setTimeout(() => void loadFit().catch(() => undefined), 3000);
    } finally {
      hidePlayBoot(!menuReady);
    }
    if (!saved && !fromAccount) this.showOnboarding();
    else {
      if (this.pendingPlan) this.go('plan');
      await this.checkRecovery();
    }
  }

  /** A link from the training page, including one saved through the sign-in redirect. */
  private takePlanLink(): string {
    const fromUrl = new URLSearchParams(location.search).get('plan');
    const stored = sessionStorage.getItem('cb-plan');
    const id = fromUrl || stored || '';
    if (fromUrl || stored) sessionStorage.removeItem('cb-plan');
    if (fromUrl) history.replaceState(null, '', '/play');
    if (!id || !planById(id)) return '';
    this.selectedPlan = id;
    return id;
  }

  // ---------------------------------------------------------------- world & loop

  private async loadWorld(routeId: string): Promise<void> {
    if (this.world?.route.def.id === routeId && !this.world.roadWriting) return;
    await this.mountWorld(getRoute(getRouteDef(routeId)));
  }

  private async mountWorld(route: Route, onProgress?: (visual: number) => void, writing?: RoadWriting): Promise<void> {
    await new Promise((r) => setTimeout(r, 30));
    await Promise.all([loadRouteTerrain(route), preloadPropAssets()]);
    this.world?.dispose();
    this.world = new World(route, this.canvas, this.graphics, this.profile.graphics, this.profile.timeOfDay, { roadWriting: writing });
    this.graphics = this.world.graphicsRef;
    this.world.setRiderColors([this.profile.colors]);
    this.world.setFlyoverStart(route.climbs[0]?.start ?? 0);
    this.world.resize();
    await this.waitForTerrain(onProgress);
  }

  /** Terrain streams in after the world exists. 0.7 is far enough along to ride. */
  private waitForTerrain(onProgress?: (visual: number) => void): Promise<void> {
    const started = performance.now();
    return new Promise((resolve) => {
      const check = () => {
        const loaded = this.world?.loadProgress ?? 0;
        onProgress?.(Math.min(1, loaded / 0.7));
        const elapsed = performance.now() - started;
        if ((loaded > 0.7 && elapsed > 800) || elapsed > 20000) {
          onProgress?.(1);
          resolve();
        } else {
          window.setTimeout(check, 80);
        }
      };
      check();
    });
  }

  private paintRideLoad(route: Route, climb: Climb | undefined, visual: number, reverse = false): void {
    const loadingEl = $('#loading', this.ui);
    const canvas = $<HTMLCanvasElement>('#load-profile', this.ui);
    const span = climb ? { start: climb.start, end: climb.end } : undefined;
    drawLoadProfile(canvas, route, visual, span, reverse);
    loadingEl.setAttribute('aria-valuenow', String(Math.round(Math.max(0, Math.min(1, visual)) * 100)));
    loadingEl.setAttribute('aria-label', `Loading ${climb ? climb.name : route.def.name}`);
  }

  /** Logo and the selected road's side profile. The colour fills with the map. */
  private async presentRideLoad(route: Route, climb?: Climb, reverse = false, writing?: RoadWriting): Promise<void> {
    const loadingEl = $('#loading', this.ui);
    loadingEl.classList.remove('hidden', 'is-leaving');
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const paint = (visual: number) => this.paintRideLoad(route, climb, visual, reverse);
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const same = this.world?.route.def.id === route.def.id && sameRoadWriting(this.world.roadWriting, writing);
    if (same) {
      paint(reduce ? 1 : 0);
      if (!reduce) await this.sweepRideLoad(paint, 700);
    } else {
      paint(0);
      await this.mountWorld(route, paint, writing);
      paint(1);
    }
    await new Promise((r) => setTimeout(r, reduce ? 80 : 180));
  }

  private sweepRideLoad(paint: (visual: number) => void, ms: number): Promise<void> {
    const started = performance.now();
    return new Promise((resolve) => {
      const step = (now: number) => {
        const t = Math.min(1, (now - started) / ms);
        paint(t);
        if (t < 1) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
  }

  private dismissRideLoad(): void {
    const loadingEl = $('#loading', this.ui);
    const done = () => {
      loadingEl.classList.add('hidden');
      loadingEl.classList.remove('is-leaving');
      this.loading = false;
    };
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      done();
      return;
    }
    loadingEl.classList.add('is-leaving');
    window.setTimeout(done, 360);
  }

  private abortRideLoad(): void {
    const loadingEl = $('#loading', this.ui);
    loadingEl.classList.add('hidden');
    loadingEl.classList.remove('is-leaving');
    this.loading = false;
  }

  /**
   * Steps the ride up to `now` in chunks of at most 0.1 s, so slow frames and
   * background tabs do not lose ride time. `maxSec` caps one catch-up.
   */
  private advanceSession(now: number, maxSec: number): void {
    const s = this.session;
    if (s !== this.clockSession) {
      // A new ride starts its clock here.
      this.clockSession = s;
      this.sessionClock = now;
      return;
    }
    if (!s) {
      this.sessionClock = now;
      return;
    }
    let left = Math.min(maxSec, Math.max(0, (now - this.sessionClock) / 1000));
    this.sessionClock = now;
    this.applyBrake();
    while (left > 1e-6 && this.session === s) {
      const h = Math.min(0.1, left);
      s.update(h, this.devices, this.braking);
      left -= h;
      this.autosaveTimer += h;
    }
    if (this.session === s && this.autosaveTimer > 30 && s.state !== 'finished') {
      this.autosaveTimer = 0;
      const snap = s.snapshot();
      void this.storage.saveActiveRide({ id: 'current', summary: snap.summary, samples: snap.samples, savedAt: new Date().toISOString() });
    }
  }

  private syncLaneUsers(s: RideSession, trial = false): LaneUser[] {
    const racers = s.sim.racers;
    const out = this.laneUsers;
    // In a time trial the last rider off the ramp is the broom: the tail car follows them.
    // Riders still waiting on the ramp are not on the road yet.
    let broom = -1;
    let broomAt = -1;
    if (trial) {
      for (const r of racers) {
        if (r.ttStart >= broomAt) {
          broomAt = r.ttStart;
          broom = r.id;
        }
      }
    }
    let n = 0;
    for (let i = 0; i < racers.length; i++) {
      const r = racers[i];
      if (trial && s.sim.time < r.ttStart) continue;
      const u = out[n] ?? (out[n] = { s: 0, lat: 0, speed: 0, dir: 1, broom: false });
      u.s = r.s;
      u.lat = r.lat;
      u.speed = r.v;
      u.dir = r.direction;
      u.broom = r.id === broom;
      n++;
    }
    out.length = n;
    return out;
  }

  /** Menus and the garage draw at about 30 fps. A ride draws every display frame. */
  private static readonly MENU_FRAME_MS = 1000 / 30;
  private loop() {
    const now = performance.now();
    this.syncOverlayPointer();
    this.advanceSession(now, FRAME_CATCH_UP_SEC);
    // Perf: the AI power meter reads the riders once per drawn frame, not every physics substep.
    // A hidden tab draws no frames, so its catch-up never reads it (the first frame back settles it in one go).
    this.session?.settleMeter();
    const world = this.world;
    // A 2 ms allowance, so a 60 Hz display lands on every second frame and not every third.
    if (world && !this.session && now - this.last < App.MENU_FRAME_MS - 2) {
      requestAnimationFrame(() => this.loop());
      return;
    }
    // Rendering stays capped; the ride itself catches up to real time.
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (world) {
      const s = this.session;
      // Dynamic resolution only while riding; the menus run at a fixed 30 fps.
      world.graphicsRef.adaptive = !!s;
      if (s) {
        const poses = s.riderPoses(world);
        const trial = s.config.career?.road.timeTrial === true;
        const riders = this.syncLaneUsers(s, trial);
        const waiting = trial && s.sim.time < s.player.ttStart;
        const focusS = s.watchingFinish ? s.sim.finishLine : waiting ? s.sim.opts.startS : s.player.s;
        const spin = s.watchingFinish ? (s.sim.raceDir() > 0 ? Math.PI : 0) : s.sim.facingAngle();
        const ramp = trial ? { s: s.sim.opts.startS, dir: s.sim.raceDir() } : undefined;
        world.update(dt, focusS, s.player.lat, poses, riders, spin, ramp);
        this.updateRiderTag(s, poses, world);
        this.updateSound(s, dt);
        this.hudTimer += dt;
        if (this.hudTimer > 0.1) {
          this.hudTimer = 0;
          this.hud.update(s, this.devices, now);
          this.roadAhead.update(s, now);
          this.refreshTools();
          this.announceSegments(s);
          this.syncCareerRide(s);
        }
      } else {
        this.riderTag.hide();
        const garageS = 40;
        world.poseAt(garageS, 0, this.garagePose);
        this.garagePose.visible = this.screen === 'garage';
        this.garagePose.crank += dt * (this.screen === 'garage' ? 3 : 0);
        this.garagePose.wheel += dt * (this.screen === 'garage' ? 7.5 : 0);
        world.update(dt, garageS, 0, [this.garagePose]);
      }
    }
    requestAnimationFrame(() => this.loop());
  }

  // ---------------------------------------------------------------- devices bar

  private renderDevices(s: DeviceStatus) {
    const el = document.getElementById('devices');
    if (!el) return;
    el.innerHTML = devicesHtml(s, this.devices.isVirtual);
    const paused = this.overlay.querySelector('.pause-devices');
    if (paused) paused.innerHTML = devicesHtml(s, this.devices.isVirtual);
    $$('[data-act]', el).forEach((b) => b.addEventListener('click', () => this.onDeviceAction(b.dataset.act!)));
    if (s.error) toast(s.error, 'error', 7000);
  }

  private onDeviceAction(act: string) {
    if (act === 'connect-trainer') {
      if (!bluetoothSupported()) {
        toast('Web Bluetooth is not available. Please open CycleBuddy in Google Chrome or Microsoft Edge.', 'error', 7000);
        return;
      }
      void this.devices.connectTrainer();
    } else if (act === 'connect-hr') void this.devices.connectHeartRate();
    else if (act === 'virtual') {
      this.devices.useVirtualTrainer(Math.round(this.profile.ftp * 0.7));
      toast('Virtual trainer on: use the Up/Down arrow keys to change power.', 'info');
    }
  }

  // ---------------------------------------------------------------- screens

  private onCareerPath(): boolean {
    return location.pathname.replace(/\/$/, '') === '/play/career';
  }

  /** Career lives at /play/career. Every other game screen stays on /play. */
  private syncPlayPath(screen: Screen): void {
    const want = screen === 'career' ? '/play/career' : '/play';
    const now = location.pathname.replace(/\/$/, '') || '/';
    if (now === want) return;
    history.pushState({ screen }, '', want);
  }

  private onPlayPath(): void {
    if (this.session) {
      this.syncPlayPath(this.screen);
      return;
    }
    const next: Screen = this.onCareerPath() ? 'career' : 'home';
    if (this.screen === next) return;
    if (next === 'career' && this.screen === 'home') this.enterCareer();
    this.screen = next;
    this.render();
  }

  /** The play menu opens the season menu. A prepared race stays on the Continue card. */
  private enterCareer(): void {
    if (this.career.state && !this.career.state.offers?.length) this.career.tab = 'hub';
  }

  /**
   * `freeRegion` opens Free ride inside that landscape. With no region, Free ride
   * starts on the landscape cards.
   */
  private go(screen: Screen, freeRegion?: string) {
    if (screen === 'history' && this.screen === 'home') {
      const today = new Date();
      this.analyticsPage = 'dashboard';
      this.analyticsYear = today.getFullYear();
      this.analyticsMonthIndex = today.getMonth();
      this.analyticsDay = null;
    }
    if (screen === 'free' && this.screen !== 'free') this.freeRegion = freeRegion ?? null;
    if (screen === 'career' && this.screen === 'home') this.enterCareer();
    this.screen = screen;
    this.syncPlayPath(screen);
    if (screen === 'plans' || screen === 'plan') {
      void this.openTraining();
      return;
    }
    this.render();
  }

  private async openTraining() {
    const screen = this.screen;
    const rides = await this.storage.listRides();
    if (this.screen !== screen) return;
    this.doneKeys = progressFromRides(rides);
    this.ftpHistory = compareFtpTests(ftpTestsFromRides(rides));
    this.render();
  }

  private render() {
    this.syncNavBack();
    if (this.session) {
      this.panel.innerHTML = '';
      return;
    }
    if (this.screen !== 'garage' && this.shopFocus) {
      this.shopFocus = null;
      this.shopPreview = { frame: null, wheels: null };
      this.world?.setRiderColors([this.profile.colors]);
    }
    if (this.world) this.world.cameraMode = this.screen === 'garage' ? 'garage' : 'flyover';
    const views: Record<Screen, () => string> = {
      home: () => this.viewHome(),
      career: () => careerHtml(this.career, this.profile.name || 'You'),
      free: () => this.viewFree(),
      race: () => this.viewRace(),
      pro: () => proRaceHtml(this.proChoice, this.profile.ftp / Math.max(30, this.profile.weightKg)),
      plans: () => this.viewPlans(),
      plan: () => this.viewPlan(),
      'train-route': () => this.viewTrainRoute(),
      garage: () => this.viewGarage(),
      history: () => '<div class="panel-body"><p>Loading...</p></div>',
      settings: () => this.viewSettings(),
      help: () => this.viewHelp(),
    };
    const careerHub = this.screen === 'career' && this.career.tab === 'hub';
    this.panel.className = `screen-${this.screen}${careerHub ? ' career-hub' : ''}`;
    this.panel.innerHTML = views[this.screen]();
    const rider = document.getElementById('home-rider');
    if (rider) {
      if (this.screen === 'home') {
        const p = this.profile;
        rider.hidden = false;
        rider.textContent = `${p.name || 'Rider'} · ${p.weightKg} kg · FTP ${p.ftp} W · ${(p.ftp / p.weightKg).toFixed(2)} W/kg`;
        rider.hidden = true; // the new menu shows the rider line itself
      } else rider.hidden = true;
    }
    $$('[data-go]', this.panel).forEach((b) => b.addEventListener('click', () => this.go(b.dataset.go as Screen)));
    const binders: Partial<Record<Screen, () => void>> = {
      free: () => this.bindFree(),
      career: () => this.bindCareer(),
      race: () => this.bindRace(),
      pro: () => bindProRace(this.panel, this.proChoice, () => this.render(), () => this.startQuickRace()),
      home: () => this.bindHome(),
      plans: () => this.bindPlans(),
      plan: () => this.bindPlan(),
      'train-route': () => this.bindTrainRoute(),
      garage: () => this.bindGarage(),
      settings: () => this.bindSettings(),
      help: () => this.bindHelp(),
      history: () => void this.renderHistory(),
    };
    binders[this.screen]?.();
  }

  /** One Back button, in the top-left of the bar. A plan returns to the plan list. A road screen returns to its landscape, then to the plan. A career page returns to the season. */
  private syncNavBack(): void {
    const button = $<HTMLButtonElement>('#nav-back', this.ui);
    const offers = this.screen === 'career' && this.career.tab === 'offers';
    button.hidden = !!this.session || this.screen === 'home' || offers;
  }

  private onNavBack(): void {
    if (this.screen === 'free' && this.freeRegion) {
      this.freeRegion = null;
      this.render();
      return;
    }
    if (this.screen === 'train-route') {
      if (this.trainRegion) {
        this.trainRegion = null;
        this.render();
        return;
      }
      this.go('plan');
      return;
    }
    if (this.screen === 'plan') {
      this.go('plans');
      return;
    }
    if (this.screen === 'career' && this.career.state && this.career.tab !== 'hub' && this.career.tab !== 'pick') {
      if (this.career.tab === 'riders' && this.career.browseTeam) {
        this.career.browseTeam = null;
        this.render();
        return;
      }
      this.career.tab = 'hub';
      this.render();
      return;
    }
    this.go('home');
  }

  private header(title: string, subtitle = ''): string {
    return `<div class="panel-head"><h2>${title}</h2>${subtitle ? `<p class="muted">${subtitle}</p>` : ''}</div>`;
  }

  private viewHome(): string {
    const trainer = this.devices.hasTrainer ? 'Trainer connected' : 'No trainer yet';
    return homeHtml({ name: this.profile.name, weightKg: this.profile.weightKg, ftp: this.profile.ftp, trainer }, brandLogo());
  }

  private bindHome(): void {
    const canvas = this.panel.querySelector<HTMLCanvasElement>('[data-climb-profile]');
    const c = canvas ? REAL_CLIMBS.find((x) => x.id === canvas.dataset.climbProfile) : undefined;
    if (canvas && c) {
      // Perf: a real road's track is fetched on demand, so the home menu draws its profile once it arrives.
      void ensureTrack(c.id)
        .then(() => {
          if (!canvas.isConnected) return;
          const route = getRoute(realClimbRoute(c));
          const climb = route.climbs[0];
          if (climb) requestAnimationFrame(() => drawRoadbook(canvas, route, { from: climb.start, to: climb.end, binM: 1000, compact: true }));
        })
        .catch(() => undefined);
    }
    this.panel.querySelector<HTMLElement>('[data-ride-climb]')?.addEventListener('click', (e) => {
      const id = (e.currentTarget as HTMLElement).dataset.rideClimb ?? '';
      const climb = REAL_CLIMB_MAP.get(id);
      if (climb) {
        this.selectedRoute = climb.id;
        this.startIndex = 0;
        this.scrollFreeSelection = true;
      }
      this.go('free', REAL_RIDE.id);
    });
  }

  private startQuickRace(): void {
    const launch = launchQuickRace({
      ...this.proChoice,
      ftpWkg: this.profile.ftp / Math.max(30, this.profile.weightKg),
      colors: { ...this.profile.colors },
    });
    if (!launch) {
      toast('That stage could not be built.', 'error');
      return;
    }
    this.pendingLaunch = launch;
    void this.startRide('race');
  }

  // ---- Free ride

  private defById(id: string): RouteDef {
    const climb = REAL_CLIMB_MAP.get(id);
    if (climb) return realClimbRoute(climb);
    return getRouteDef(id);
  }

  /**
   * One Free ride card. A real road whose track is not fetched yet has no `route`: its
   * length and climbing come from the generated track index (equal to what the route
   * measures, `trackIndex.test.ts`), so the list sorts the same before and after.
   */
  private freeRow(def: RouteDef): FreeRow {
    const r = getRoute(def);
    return { id: def.id, name: def.name, description: def.description, difficulty: def.difficulty, length: r.length, ascent: r.totalAscent, route: r };
  }

  private realFreeRow(c: RealClimb): FreeRow {
    if (trackReady(c.id)) return this.freeRow(realClimbRoute(c));
    const stats = realRoadStats(c.id);
    return { id: c.id, name: c.name, description: c.description, difficulty: realRoadDifficulty(c), length: stats?.length ?? 0, ascent: stats?.ascent ?? 0, route: null };
  }

  private sortedFreeRoutes(): FreeRow[] {
    const real = this.freeRegion === REAL_RIDE.id;
    const region = !real && this.freeRegion ? rideRegion(this.freeRegion) : undefined;
    const allowed = region ? new Set(region.routes) : null;
    let list: FreeRow[];
    if (real) {
      const climbs = realRoadClimbs();
      // Ride it now can pick a published climb that has no 1:1 road yet. Show that one here so the rider can start it.
      const chosen = REAL_CLIMB_MAP.get(this.selectedRoute);
      if (chosen && !climbs.some((c) => c.id === chosen.id)) climbs.push(chosen);
      list = climbs.map((c) => this.realFreeRow(c));
    } else list = ROUTES.filter((def) => !allowed || allowed.has(def.id)).map((def) => this.freeRow(def));
    const byName = (a: FreeRow, b: FreeRow) => a.name.localeCompare(b.name);
    const byType = (a: FreeRow, b: FreeRow) => DIFFICULTY_RANK[a.difficulty] - DIFFICULTY_RANK[b.difficulty] || byName(a, b);
    const dir = this.freeSortDesc ? -1 : 1;
    if (this.freeSort === 'type') {
      return list.sort((a, b) => dir * (DIFFICULTY_RANK[a.difficulty] - DIFFICULTY_RANK[b.difficulty]) || byName(a, b));
    }
    // Perf: the sort key is read once per route (into the row) before sorting, not twice per comparison.
    const metric = this.freeSort === 'distance' ? (row: FreeRow) => row.length : (row: FreeRow) => row.ascent;
    return list.sort((a, b) => dir * (metric(a) - metric(b)) || byType(a, b));
  }

  private viewFree(): string {
    if (this.freeRegion && this.freeRegion !== REAL_RIDE.id && !rideRegion(this.freeRegion)) this.freeRegion = null;
    if (!this.freeRegion) return this.viewFreeWorlds();
    return this.viewFreeRoutes();
  }

  private regionCards(): string {
    return RIDE_REGIONS.map((region) => {
      const count = region.routes.length;
      const loops = count === 1 ? '1 loop' : `${count} loops`;
      return `
        <button class="region-card" type="button" data-region="${region.id}">
          <img src="${region.image ?? `/route-previews/${region.cover}.jpg`}" alt="" width="400" height="225" decoding="async" loading="lazy" />
          <span class="region-copy"><b>${esc(region.name)}</b><small>${loops}</small></span>
        </button>`;
    }).join('');
  }

  private viewFreeWorlds(): string {
    return `
      ${this.header('Free Ride', 'Choose a landscape, or the real climbs.')}
      <div class="panel-body">
        <div class="region-grid">${this.regionCards()}${this.realClimbCard()}</div>
      </div>`;
  }

  private realClimbCard(): string {
    const count = realRoadClimbs().length;
    const label = count === 1 ? '1 climb' : `${count} climbs`;
    return `
        <button class="region-card" type="button" data-region="${REAL_RIDE.id}">
          <span class="region-real"></span>
          <span class="region-copy"><b>${esc(REAL_RIDE.name)}</b><small>${label}</small></span>
        </button>`;
  }

  private viewFreeRoutes(): string {
    const real = this.freeRegion === REAL_RIDE.id;
    const region = real ? undefined : rideRegion(this.freeRegion ?? '');
    const p = this.profile;
    const routes = this.sortedFreeRoutes();
    const parts: string[] = [];
    let lastType: Difficulty | '' = '';
    for (const def of routes) {
      if (this.freeSort === 'type' && def.difficulty !== lastType) {
        lastType = def.difficulty;
        const count = routes.filter((item) => item.difficulty === def.difficulty).length;
        const noun = real ? 'climb' : 'loop';
        parts.push(`<h3 class="route-group">${DIFFICULTY_LABEL[def.difficulty]} <span>${count === 1 ? `1 ${noun}` : `${count} ${noun}s`}</span></h3>`);
      }
      const r = def.route;
      const reverse = this.reverseRoutes.has(def.id);
      // A real road still being fetched shows its numbers from the index; lap, climbs and profile follow (bindFree).
      const lap = r ? formatDuration(estimateLap(r, p.ftp, p.weightKg, 0.72, reverse)) : '…';
      const climbs = r ? this.climbRows(r, reverse) : '';
      parts.push(`
        <div class="route-card ${real ? 'no-shot' : ''} ${def.id === this.selectedRoute ? 'selected' : ''}" data-route="${def.id}">
          <div class="route-side">
            <canvas class="route-profile" data-profile="${def.id}"></canvas>
            ${real ? '' : `<img class="route-shot" src="/route-previews/${def.id}.jpg" alt="" width="400" height="225" decoding="async" loading="lazy" />`}
            <div class="stats">
              <span><small>Distance</small>${(def.length / 1000).toFixed(1)} km</span>
              <span><small>Climbing</small>${Math.round(def.ascent)} m</span>
              <span><small>Est. lap</small><span data-lap>${lap}</span></span>
            </div>
          </div>
          <div class="route-card-head"><b>${esc(def.name)}</b><span class="badge ${def.difficulty}">${DIFFICULTY_LABEL[def.difficulty]}</span></div>
          <p class="route-blurb">${esc(def.description)}</p>
          <div class="climbs" ${climbs ? '' : 'hidden'}>${climbs}</div>
          <label class="route-reverse" data-reverse>
            <input type="checkbox" ${reverse ? 'checked' : ''} />
            Ride in reverse
          </label>
        </div>`);
    }
    const sorts = FREE_SORTS.map((item) => {
      const on = item.id === this.freeSort;
      const desc = on ? this.freeSortDesc : item.id !== 'type';
      const arrow = on ? (desc ? '↓' : '↑') : '';
      return `<button class="chip ${on ? 'selected' : ''}" data-sort="${item.id}" title="${esc(freeSortHint(item.id, desc))}">${item.label}${arrow ? `<span class="sort-dir">${arrow}</span>` : ''}</button>`;
    }).join('');
    const title = real ? REAL_RIDE.name : region?.name ?? 'Free Ride';
    const subtitle = real ? REAL_RIDE.line : region?.line ?? 'Choose a loop and where to start.';
    return `
      ${this.header(title, subtitle)}
      <div class="panel-body">
        <div class="route-tools">
          <div class="route-sort">
            <span class="muted">Sort</span>
            ${sorts}
          </div>
          <p class="muted small route-note">The profile is coloured by steepness. Climbs are the bright line. Tick Ride in reverse on a loop to ride that one the other way; its profile, climbs and lap estimate follow. Estimated lap time is at 72% of your FTP (${Math.round(p.ftp * 0.72)} W).</p>
        </div>
        <div class="route-list">${parts.join('')}</div>
      </div>
      <div class="panel-foot stack">
        <div class="buddy-setup">
          <label class="check"><input type="checkbox" id="buddy-on" ${this.buddyOn ? 'checked' : ''} /> Ride with a buddy</label>
          <div class="buddy-efforts" id="buddy-efforts" ${this.buddyOn ? '' : 'hidden'}>
            <label><span>Flat</span><b id="buddy-flat-label">${this.buddyReadout(this.buddyFlat)}</b>
              <input type="range" min="1" max="6" step="0.1" value="${this.buddyFlat}" id="buddy-flat" />
            </label>
            <label><span>Hills 2–5%</span><b id="buddy-hill-label">${this.buddyReadout(this.buddyHill)}</b>
              <input type="range" min="1" max="6" step="0.1" value="${this.buddyHill}" id="buddy-hill" />
            </label>
            <label><span>Mountains &gt;5%</span><b id="buddy-mountain-label">${this.buddyReadout(this.buddyMountain)}</b>
              <input type="range" min="1" max="6" step="0.1" value="${this.buddyMountain}" id="buddy-mountain" />
            </label>
          </div>
        </div>
        <div class="starts"></div>
        <button class="btn big" id="start-free">Start ride</button>
      </div>`;
  }

  /** W/kg and the watts that effort is at the player's weight. */
  private buddyReadout(wkg: number): string {
    const watts = Math.round(wkg * this.profile.weightKg);
    return `${wkg.toFixed(1)} W/kg · ${watts}\u00a0W`;
  }

  private bindFree() {
    $$('[data-region]', this.panel).forEach((el) =>
      el.addEventListener('click', () => {
        const id = el.dataset.region;
        if (!id || (id !== REAL_RIDE.id && !rideRegion(id))) return;
        this.freeRegion = id;
        const routes = this.sortedFreeRoutes();
        if (!routes.some((def) => def.id === this.selectedRoute)) {
          const first = routes[0];
          if (first) {
            this.selectedRoute = first.id;
            this.startIndex = 0;
          }
        }
        this.render();
      }),
    );
    if (!this.freeRegion) return;
    $$('[data-sort]', this.panel).forEach((el) =>
      el.addEventListener('click', () => {
        const sort = el.dataset.sort as FreeSort;
        if (sort !== 'distance' && sort !== 'climbing' && sort !== 'type') return;
        if (this.freeSort === sort) this.freeSortDesc = !this.freeSortDesc;
        else {
          this.freeSort = sort;
          this.freeSortDesc = sort !== 'type';
        }
        this.render();
      }),
    );
    $$('[data-route]', this.panel).forEach((el) => {
      const id = el.dataset.route!;
      const canvas = el.querySelector<HTMLCanvasElement>('canvas.route-profile');
      if (canvas && trackReady(id)) drawRouteCard(canvas, getRoute(this.defById(id)), this.reverseRoutes.has(id));
      // Focusing a partly visible card scrolls the list. Keep the position the rider left it at.
      el.addEventListener('mousedown', () => {
        const body = $('.panel-body', this.panel);
        const scroll = body.scrollTop;
        requestAnimationFrame(() => {
          body.scrollTop = scroll;
        });
      });
      el.addEventListener('click', (ev) => {
        if ((ev.target as HTMLElement).closest('[data-reverse]')) return;
        if (this.selectedRoute === id) return;
        this.selectedRoute = id;
        this.startIndex = 0;
        $$('[data-route]', this.panel).forEach((x) => x.classList.toggle('selected', x.dataset.route === id));
        this.paintStarts();
      });
      const box = el.querySelector<HTMLInputElement>('input[type="checkbox"]');
      box?.addEventListener('change', () => {
        if (box.checked) this.reverseRoutes.add(id);
        else this.reverseRoutes.delete(id);
        if (this.selectedRoute !== id) {
          this.selectedRoute = id;
          this.startIndex = 0;
          $$('[data-route]', this.panel).forEach((x) => x.classList.toggle('selected', x.dataset.route === id));
          this.paintStarts();
        }
        this.paintFreeCard(el, id);
      });
    });
    this.paintStarts();
    const buddyOn = $<HTMLInputElement>('#buddy-on', this.panel);
    const efforts = $('#buddy-efforts', this.panel);
    buddyOn.addEventListener('change', () => {
      this.buddyOn = buddyOn.checked;
      efforts.hidden = !this.buddyOn;
    });
    const bindBuddy = (id: string, labelId: string, set: (n: number) => void) => {
      const slider = $<HTMLInputElement>(id, this.panel);
      slider.addEventListener('input', () => {
        const n = Math.round(Number(slider.value) * 10) / 10;
        set(n);
        $(labelId, this.panel).textContent = this.buddyReadout(n);
      });
    };
    bindBuddy('#buddy-flat', '#buddy-flat-label', (n) => (this.buddyFlat = n));
    bindBuddy('#buddy-hill', '#buddy-hill-label', (n) => (this.buddyHill = n));
    bindBuddy('#buddy-mountain', '#buddy-mountain-label', (n) => (this.buddyMountain = n));
    $('#start-free', this.panel).addEventListener('click', () => void this.startRide('free'));
    if (this.scrollFreeSelection) {
      this.scrollFreeSelection = false;
      this.panel.querySelector<HTMLElement>(`[data-route="${cssEscape(this.selectedRoute)}"]`)?.scrollIntoView({ block: 'center' });
    }
    if (this.freeRegion === REAL_RIDE.id && !allTracksReady()) {
      // Perf: the Real climbs list opens at once from the track index; profiles, laps and
      // starts fill in when the tracks arrive. Rebuild keeps the rider's scroll position.
      void ensureAllTracks()
        .then(() => {
          if (this.session || this.screen !== 'free' || this.freeRegion !== REAL_RIDE.id) return;
          const scroll = this.panel.querySelector<HTMLElement>('.panel-body')?.scrollTop ?? 0;
          this.render();
          const body = this.panel.querySelector<HTMLElement>('.panel-body');
          if (body) body.scrollTop = scroll;
        })
        .catch(() => toast('Could not load the real roads. Check the connection.', 'error'));
    }
  }

  /** Named climbs as the rider will meet them, forward or backwards. */
  private climbRows(route: Route, reverse: boolean): string {
    return riddenClimbs(route, reverse)
      .map(
        (c) =>
          `<div class="climb-row"><b>${esc(c.name)}</b><span>${(c.length / 1000).toFixed(1)} km · ${(c.avgGrade * 100).toFixed(1)}% · max ${(c.maxGrade * 100).toFixed(0)}%</span></div>`,
      )
      .join('');
  }

  /** Redraw one free-ride card. Rebuilding the list would jump the scroll position. */
  private paintFreeCard(card: HTMLElement, id: string) {
    if (!trackReady(id)) return; // the rebuild when the tracks arrive paints it
    const route = getRoute(this.defById(id));
    const reverse = this.reverseRoutes.has(id);
    const canvas = card.querySelector<HTMLCanvasElement>('canvas.route-profile');
    if (canvas) drawRouteCard(canvas, route, reverse);
    const climbs = card.querySelector<HTMLElement>('.climbs');
    if (climbs) {
      const rows = this.climbRows(route, reverse);
      climbs.innerHTML = rows;
      climbs.hidden = rows.length === 0;
    }
    const lap = card.querySelector<HTMLElement>('[data-lap]');
    if (lap) lap.textContent = formatDuration(estimateLap(route, this.profile.ftp, this.profile.weightKg, 0.72, reverse));
  }

  /** Swap the start chips without rebuilding the route list, so the scroll position stays. */
  private paintStarts() {
    const host = $('.starts', this.panel);
    if (!trackReady(this.selectedRoute)) {
      host.innerHTML = ''; // filled by the rebuild when the track arrives
      return;
    }
    const starts = routeStarts(getRoute(this.defById(this.selectedRoute)));
    if (this.startIndex >= starts.length) this.startIndex = 0;
    host.innerHTML =
      `<span class="muted">Start</span>` +
      starts.map((st, i) => `<button class="chip ${i === this.startIndex ? 'selected' : ''}" data-start="${i}">${esc(st.name)}</button>`).join('');
    $$('[data-start]', host).forEach((el) =>
      el.addEventListener('click', () => {
        this.startIndex = Number(el.dataset.start);
        $$('[data-start]', host).forEach((x) => x.classList.toggle('selected', Number(x.dataset.start) === this.startIndex));
      }),
    );
  }

  // ---- Race

  private allClimbs(): { route: Route; climb: Climb }[] {
    const list: { route: Route; climb: Climb }[] = [];
    for (const def of ROUTES) {
      const r = getRoute(def);
      for (const c of r.climbs) if (c.length >= 2500) list.push({ route: r, climb: c });
    }
    for (const real of REAL_CLIMBS) {
      const r = getRoute(realClimbRoute(real));
      const c = r.climbs.find((x) => x.id === real.id) ?? r.climbs[0];
      if (c) list.push({ route: r, climb: c });
    }
    return list;
  }

  private climbLoops(): { id: string; name: string; count: number }[] {
    const counts = new Map<string, { name: string; count: number }>();
    for (const { route } of this.allClimbs()) {
      const row = counts.get(route.def.id) ?? { name: route.def.name, count: 0 };
      row.count += 1;
      counts.set(route.def.id, row);
    }
    return [...counts.entries()]
      .map(([id, row]) => ({ id, name: row.name, count: row.count }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Length, grade and elevation start with the biggest. Route starts A to Z. Clicking the active sort reverses it. */
  private raceClimbs(): { route: Route; climb: Climb }[] {
    if (this.climbRoute && !this.climbLoops().some((loop) => loop.id === this.climbRoute)) this.climbRoute = '';
    const list = this.allClimbs().filter((item) => !this.climbRoute || item.route.def.id === this.climbRoute);
    const byName = (a: { route: Route; climb: Climb }, b: { route: Route; climb: Climb }) =>
      a.route.def.name.localeCompare(b.route.def.name) || a.climb.start - b.climb.start || a.climb.name.localeCompare(b.climb.name);
    if (this.climbSort === 'route') {
      const dir = this.climbSortDesc ? -1 : 1;
      return list.sort((a, b) => dir * (a.route.def.name.localeCompare(b.route.def.name)) || a.climb.start - b.climb.start || a.climb.name.localeCompare(b.climb.name));
    }
    const value = (item: { route: Route; climb: Climb }) =>
      this.climbSort === 'length' ? item.climb.length : this.climbSort === 'grade' ? item.climb.avgGrade : item.climb.gain;
    const dir = this.climbSortDesc ? -1 : 1;
    return list.sort((a, b) => dir * (value(a) - value(b)) || byName(a, b));
  }

  private climbCard(route: Route, climb: Climb): string {
    const t = estimateTime(route, climb.start, climb.end, this.profile.ftp, this.profile.weightKg, 1.0);
    return `
        <button class="route-card ${climb.id === this.selectedClimb ? 'selected' : ''}" data-climb="${climb.id}" data-climb-name="${esc(climb.name)}" data-loop-name="${esc(route.def.name)}">
          <div class="route-card-head"><b>${esc(climb.name)}</b><span class="badge ${route.def.difficulty}">${DIFFICULTY_LABEL[route.def.difficulty]}</span></div>
          <p class="climb-where"><span>Loop</span> ${esc(route.def.name)}</p>
          <p class="muted climb-note">${esc(climb.inspiredBy)}</p>
          <canvas class="route-profile climb-profile" data-climb-profile="${climb.id}"></canvas>
          <div class="stats">
            <span><small>Length</small>${(climb.length / 1000).toFixed(1)} km</span>
            <span><small>Avg grade</small>${(climb.avgGrade * 100).toFixed(1)}%</span>
            <span><small>Max</small>${(climb.maxGrade * 100).toFixed(1)}%</span>
            <span><small>Elevation</small>+${Math.round(climb.gain)} m</span>
            <span><small>Your est.</small>${formatDuration(t)}</span>
          </div>
          <div class="pb" data-pb="${climb.id}"></div>
        </button>`;
  }

  private viewRace(): string {
    // Perf: real-road tracks are fetched on demand; this list measures every climb, so it waits for them (bindRace).
    if (!allTracksReady()) return `${this.header('Hill-Climb Race')}<div class="panel-body"><p class="muted">Loading the real roads…</p></div>`;
    const all = this.allClimbs();
    if (!this.selectedClimb || !all.some((item) => item.climb.id === this.selectedClimb)) {
      this.selectedClimb = all.find((item) => item.climb.id === 'alpine-geant')?.climb.id ?? all[0]?.climb.id ?? '';
    }
    const climbs = this.raceClimbs();
    if (climbs.length && !climbs.some((item) => item.climb.id === this.selectedClimb)) this.selectedClimb = climbs[0].climb.id;
    const loops = this.climbLoops();
    const total = loops.reduce((sum, loop) => sum + loop.count, 0);
    const parts: string[] = [];
    let lastLoop = '';
    for (const { route, climb } of climbs) {
      if (this.climbSort === 'route' && route.def.id !== lastLoop) {
        lastLoop = route.def.id;
        const count = climbs.filter((item) => item.route.def.id === route.def.id).length;
        parts.push(`<h3 class="climb-group">${esc(route.def.name)} <span>${count === 1 ? '1 climb' : `${count} climbs`}</span></h3>`);
      }
      parts.push(this.climbCard(route, climb));
    }
    const sorts = CLIMB_SORTS.map((item) => {
      const on = item.id === this.climbSort;
      const desc = on ? this.climbSortDesc : item.id !== 'route';
      const arrow = on ? (desc ? '↓' : '↑') : '';
      return `<button class="chip ${on ? 'selected' : ''}" data-climb-sort="${item.id}" title="${esc(climbSortHint(item.id, desc))}">${item.label}${arrow ? `<span class="sort-dir">${arrow}</span>` : ''}</button>`;
    }).join('');
    const loopOptions = loops
      .map((loop) => `<option value="${esc(loop.id)}"${loop.id === this.climbRoute ? ' selected' : ''}>${esc(loop.name)} (${loop.count})</option>`)
      .join('');
    return `
      ${this.header('Hill-Climb Race', 'Mass start at the bottom, finish at the summit. The strongest W/kg is what the best climber holds. Everyone else is spread from just under that down to your slowest.')}
      <div class="race-setup">
        <div class="effort-grid">
          <label class="field">AI riders <b id="ai-count-label">${this.aiCount}</b>
            <input type="range" min="50" max="100" step="5" value="${this.aiCount}" id="ai-count" />
          </label>
          <label class="field">Strongest <b id="ai-top-label">${this.aiTop.toFixed(1)}</b> W/kg
            <input type="range" min="1.5" max="6.5" step="0.1" value="${this.aiTop}" id="ai-top" />
          </label>
          <label class="field">Slowest <b id="ai-bot-label">${this.aiBottom.toFixed(1)}</b> W/kg
            <input type="range" min="1" max="6" step="0.1" value="${this.aiBottom}" id="ai-bot" />
          </label>
        </div>
        <p class="muted small">Riders are the best climbers from Career, named like T. Novarik. He holds the strongest W/kg. The others sit just under that and spread down to the slowest, so the gaps open near the summit. A shorter field leaves out the weaker climbers, and riders with a similar rating can still change places.</p>
      </div>
      <div class="panel-body">
        <div class="climb-tools">
          <div class="route-sort">
            <span class="muted">Sort</span>
            ${sorts}
            <div class="climb-filters">
              <input id="climb-find" type="search" placeholder="Find a climb" value="${esc(this.climbQuery)}" />
              <label class="climb-loop">Loop
                <select id="climb-route">
                  <option value=""${this.climbRoute === '' ? ' selected' : ''}>All loops (${total})</option>
                  ${loopOptions}
                </select>
              </label>
            </div>
          </div>
          <p class="muted small climb-scale-note">The profiles use one scale. A longer climb is wider, and more elevation is taller.</p>
        </div>
        <div class="climb-grid">${parts.join('')}</div>
        <p class="muted climb-none" hidden>No climb matches that.</p>
      </div>
      <div class="panel-foot">
        <p class="climb-picked" id="climb-picked"></p>
        <button class="btn primary big" id="start-race">Start race</button>
      </div>`;
  }

  private paintClimbPick(): void {
    const card = this.panel.querySelector<HTMLElement>(`[data-climb="${CSS.escape(this.selectedClimb)}"]`);
    const host = this.panel.querySelector<HTMLElement>('#climb-picked');
    if (!host) return;
    const name = card?.dataset.climbName ?? '';
    const loop = card?.dataset.loopName ?? '';
    const where = loop && loop !== name ? ` <span>· ${esc(loop)}</span>` : '';
    host.innerHTML = name ? `<span>Selected</span> <b>${esc(name)}</b>${where}` : '';
  }

  private applyClimbQuery(): void {
    const q = fold(this.climbQuery.trim());
    const cards = $$<HTMLElement>('[data-climb]', this.panel);
    for (const card of cards) {
      const hay = fold(`${card.dataset.climbName ?? ''} ${card.dataset.loopName ?? ''}`);
      card.hidden = q.length > 0 && !hay.includes(q);
    }
    for (const group of $$<HTMLElement>('.climb-group', this.panel)) {
      let any = false;
      let next = group.nextElementSibling;
      while (next && !next.classList.contains('climb-group')) {
        if (next.matches('[data-climb]') && !(next as HTMLElement).hidden) any = true;
        next = next.nextElementSibling;
      }
      group.hidden = !any;
    }
    const none = this.panel.querySelector<HTMLElement>('.climb-none');
    if (none) none.hidden = cards.some((card) => !card.hidden);
  }

  private bindRace() {
    if (!allTracksReady()) {
      void ensureAllTracks()
        .then(() => {
          if (!this.session && this.screen === 'race') this.render();
        })
        .catch(() => toast('Could not load the real roads. Check the connection.', 'error'));
      return;
    }
    const all = this.allClimbs();
    const scale = {
      maxLength: Math.max(1, ...all.map((item) => item.climb.length)),
      maxGain: Math.max(1, ...all.map((item) => Math.max(1, item.climb.gain))),
    };
    $$<HTMLCanvasElement>('canvas.climb-profile', this.panel).forEach((canvas) => {
      const found = all.find((c) => c.climb.id === canvas.dataset.climbProfile);
      if (found) drawClimbCard(canvas, found.route, found.climb.start, found.climb.end, 12, 0, [], scale);
    });
    $$('[data-climb]', this.panel).forEach((el) =>
      el.addEventListener('click', () => {
        this.selectedClimb = el.dataset.climb!;
        $$('[data-climb]', this.panel).forEach((x) => x.classList.toggle('selected', x === el));
        this.paintClimbPick();
      }),
    );
    $$('[data-climb-sort]', this.panel).forEach((el) =>
      el.addEventListener('click', () => {
        const sort = el.dataset.climbSort;
        if (sort !== 'length' && sort !== 'grade' && sort !== 'elevation' && sort !== 'route') return;
        if (this.climbSort === sort) this.climbSortDesc = !this.climbSortDesc;
        else {
          this.climbSort = sort;
          this.climbSortDesc = sort !== 'route';
        }
        this.render();
      }),
    );
    $<HTMLSelectElement>('#climb-route', this.panel).addEventListener('change', () => {
      this.climbRoute = $<HTMLSelectElement>('#climb-route', this.panel).value;
      this.render();
    });
    $<HTMLInputElement>('#climb-find', this.panel).addEventListener('input', () => {
      this.climbQuery = $<HTMLInputElement>('#climb-find', this.panel).value;
      this.applyClimbQuery();
    });
    this.applyClimbQuery();
    this.paintClimbPick();
    const slider = $<HTMLInputElement>('#ai-count', this.panel);
    slider.addEventListener('input', () => {
      this.aiCount = Number(slider.value);
      $('#ai-count-label', this.panel).textContent = slider.value;
    });
    const top = $<HTMLInputElement>('#ai-top', this.panel);
    const bot = $<HTMLInputElement>('#ai-bot', this.panel);
    const paintEfforts = () => {
      $('#ai-top-label', this.panel).textContent = this.aiTop.toFixed(1);
      $('#ai-bot-label', this.panel).textContent = this.aiBottom.toFixed(1);
      top.value = String(this.aiTop);
      bot.value = String(this.aiBottom);
    };
    top.addEventListener('input', () => {
      this.aiTop = Number(top.value);
      if (this.aiBottom > this.aiTop) this.aiBottom = this.aiTop;
      paintEfforts();
    });
    bot.addEventListener('input', () => {
      this.aiBottom = Number(bot.value);
      if (this.aiTop < this.aiBottom) this.aiTop = this.aiBottom;
      paintEfforts();
    });
    $('#start-race', this.panel).addEventListener('click', () => void this.startRide('race'));
    void this.storage.listClimbEfforts().then((efforts) => {
      for (const el of $$('[data-pb]', this.panel)) {
        const best = efforts.find((e) => e.climbId === el.dataset.pb);
        if (best) el.innerHTML = `Your best: <b>${formatDuration(best.timeSec)}</b> (${best.wkg.toFixed(2)} W/kg)`;
      }
    });
  }

  // ---- Training plans

  private viewPlans(): string {
    const plans = this.planFilter === 'all' ? PLANS : PLANS.filter((plan) => plan.group === this.planFilter);
    const cards = plans.map((plan) => {
      const stats = planStats(plan);
      const done = plan.weeks.reduce((n, week) => n + week.workouts.filter((workout) => this.doneKeys.has(workoutKey(plan.id, workout.id))).length, 0);
      return `
        <button class="route-card plan-card" data-plan="${plan.id}">
          <div class="route-card-head"><b>${esc(plan.name)}</b><span class="badge ${plan.level === 'Beginner' ? 'flat' : plan.level === 'Advanced' ? 'mountain' : 'hilly'}">${plan.level}</span></div>
          <p>${esc(plan.who)}</p>
          <div class="stats">
            <span><small>Length</small>${stats.weeks} weeks</span>
            <span><small>Hours</small>${esc(stats.hoursLabel.replace(/^About /, '').replace(' a week', ''))}</span>
            <span><small>Workouts</small>${done}/${stats.workouts}</span>
          </div>
        </button>`;
    }).join('');
    const filters = [{ id: 'all' as const, label: 'All' }, ...GROUPS];
    const last = this.ftpHistory[0];
    return `
      ${this.header('Training Plans', 'The FTP test measures the number the plans use. Every interval after that is a percent of it.')}
      <div class="panel-body">
        <button class="route-card plan-card ftp-test-card" data-plan="${FTP_TEST_PLAN.id}">
          <div class="route-card-head"><b>FTP Test</b><span class="badge hilly">20 min</span></div>
          <p>Ride as hard as you can hold for 20 minutes. Your FTP becomes 95% of that average, and every test is saved so you can compare them.</p>
          <div class="stats">
            <span><small>Your FTP</small>${this.profile.ftp} W</span>
            <span><small>Tests</small>${this.ftpHistory.length}</span>
            <span><small>Latest</small>${last ? `${last.ftp} W` : 'Not yet'}</span>
          </div>
        </button>
        <div class="route-sort">
          ${filters.map((item) => `<button class="chip ${item.id === this.planFilter ? 'selected' : ''}" data-group="${item.id}">${item.label}</button>`).join('')}
        </div>
        <div class="route-grid">${cards}</div>
      </div>`;
  }

  private bindPlans() {
    $$('[data-group]', this.panel).forEach((el) =>
      el.addEventListener('click', () => {
        const group = el.dataset.group as PlanFilter;
        if (this.planFilter === group) return;
        this.planFilter = group;
        this.render();
      }),
    );
    $$('[data-plan]', this.panel).forEach((el) =>
      el.addEventListener('click', () => {
        this.selectedPlan = el.dataset.plan!;
        this.go('plan');
      }),
    );
  }

  private viewPlan(): string {
    const plan = planById(this.selectedPlan);
    if (!plan) return `${this.header('Training Plans')}<div class="panel-body"><p>That plan is not in the list.</p></div>`;
    if (plan.id === FTP_TEST_PLAN.id) return this.viewFtpTest();
    const stats = planStats(plan);
    const upcoming = nextWorkout(plan, this.doneKeys);
    const ftp = this.profile.ftp;
    const fallback = upcoming?.workout.id ?? plan.weeks[0]?.workouts[0]?.id ?? '';
    const inPlan = plan.weeks.some((week) => week.workouts.some((workout) => workout.id === this.selectedWorkout));
    if (!inPlan && fallback) this.selectedWorkout = fallback;
    const weeks = plan.weeks.map((week) => {
      const rows = week.workouts.map((workout) => {
        const steps = expandBlocks(workout.blocks);
        const load = prescribedLoad(steps);
        const done = this.doneKeys.has(workoutKey(plan.id, workout.id));
        const isNext = upcoming?.workout.id === workout.id;
        const chosen = workout.id === this.selectedWorkout;
        return `
          <button type="button" class="workout-row${done ? ' done' : ''}${chosen ? ' selected' : ''}" data-workout="${workout.id}">
            <div class="route-card-head">
              <b>${esc(workout.name)}</b>
              <span class="workout-marks">${isNext ? '<span class="badge hilly">Next</span>' : ''}${done ? '<span class="badge flat">Done</span>' : ''}<span class="badge hilly">${esc(workout.focus)}</span></span>
            </div>
            <p>${esc(workout.blurb)}</p>
            <div class="stats">
              <span><small>Time</small>${formatSession(steps.at(-1)?.end ?? 0)}</span>
              <span><small>TSS</small>${Math.round(load.tss)}</span>
              <span><small>Up to</small>${workoutPeakWatts(workout, ftp)} W</span>
            </div>
            ${barsHtml(steps)}
          </button>`;
      }).join('');
      return `
        <section class="week-block">
          <div class="week-head"><h3>${esc(week.title)}</h3>${week.recovery ? '<span class="badge flat">Easier week</span>' : ''}</div>
          <p class="muted">${esc(week.note)}</p>
          ${rows}
        </section>`;
    }).join('');
    return `
      ${this.header(plan.name, `${plan.level} · ${stats.weeks} weeks · ${esc(stats.hoursLabel)} · FTP ${ftp} W`)}
      <div class="panel-body">
        <p>${esc(plan.goal)}</p>
        <p class="muted small">Select a workout, the same way you select a road in Free Ride. ERG holds the target. Arrow keys nudge it by 1%. Press E and the road sets the resistance. A flat road keeps your speed steady.</p>
        ${weeks}
      </div>
      <div class="panel-foot stack">
        <button class="btn primary big" id="continue-route" type="button">Continue to route selection</button>
      </div>`;
  }

  private viewFtpTest(): string {
    const workout = FTP_TEST_PLAN.weeks[0].workouts[0];
    this.selectedWorkout = workout.id;
    const ftp = this.profile.ftp;
    const trend = ftpTrend(this.ftpHistory);
    const rows = this.ftpHistory.map((test) => {
      const wkg = test.weightKg ? (test.ftp / test.weightKg).toFixed(2) : '—';
      const tone = test.delta == null || test.delta === 0 ? '' : test.delta > 0 ? ' up' : ' down';
      return `<tr><td>${esc(formatFtpDate(test.at))}</td><td>${test.kind === 'twenty' ? '20 min' : 'Ramp'}</td><td>${test.average != null ? `${test.average} W` : '—'}</td><td>${test.ftp} W</td><td>${wkg}</td><td class="${tone.trim()}">${esc(ftpChangeLabel(test.delta))}</td></tr>`;
    }).join('');
    const history = this.ftpHistory.length
      ? `<p>${esc(trend ?? '')}</p><div class="ftp-history-wrap"><table class="ftp-history"><thead><tr><th>Date</th><th>Test</th><th>20-min avg</th><th>FTP</th><th>W/kg</th><th>Change</th></tr></thead><tbody>${rows}</tbody></table></div>`
      : `<p class="muted">No tests yet. Your FTP is the ${ftp} W you entered. Finish this test and that number is replaced.</p>`;
    return `
      ${this.header('FTP Test', `Your FTP is ${ftp} W until you finish the 20 minutes.`)}
      <div class="panel-body">
        <p>Sign-in asks for a number, and that number stays until you complete this test. Warm up for eight minutes. Then ride 20 minutes at the hardest pace you can hold to the end. The trainer does not hold a target during those 20 minutes, so the power is yours. Five easy minutes follow.</p>
        <p>Your FTP becomes <b>95%</b> of the average power from the 20 minutes. That is the usual way to turn a 20-minute effort into the power you could hold for about an hour. The new number replaces the one on your profile, and this test is saved with the others.</p>
        <h3>Saved tests</h3>
        ${history}
      </div>
      <div class="panel-foot stack">
        <button class="btn primary big" id="continue-route" type="button">Continue to route selection</button>
      </div>`;
  }

  private bindPlan() {
    if (!planById(this.selectedPlan)) return;
    const chosen = this.panel.querySelector<HTMLElement>('.workout-row.selected');
    chosen?.scrollIntoView({ block: 'nearest' });
    $$('[data-workout]', this.panel).forEach((el) => {
      el.addEventListener('mousedown', () => {
        const body = $('.panel-body', this.panel);
        const scroll = body.scrollTop;
        requestAnimationFrame(() => {
          body.scrollTop = scroll;
        });
      });
      el.addEventListener('click', () => {
        const id = el.dataset.workout;
        if (!id || id === this.selectedWorkout) return;
        this.selectedWorkout = id;
        $$('[data-workout]', this.panel).forEach((row) => row.classList.toggle('selected', row.dataset.workout === id));
      });
    });
    this.panel.querySelector('#continue-route')?.addEventListener('click', () => {
      if (!this.selectedWorkout) return;
      this.trainRegion = null;
      this.go('train-route');
    });
  }

  private selectedTrainWorkout(): { plan: TrainingPlan; workout: Workout } | null {
    const plan = planById(this.selectedPlan);
    const workout = plan?.weeks.flatMap((week) => week.workouts).find((item) => item.id === this.selectedWorkout);
    if (!plan || !workout) return null;
    return { plan, workout };
  }

  private trainWorkoutLine(plan: TrainingPlan, workout: Workout): string {
    const steps = expandBlocks(workout.blocks);
    const time = formatSession(steps.at(-1)?.end ?? 0);
    const focus = workout.focus.toLowerCase() === plan.name.toLowerCase() ? '' : `${workout.focus} · `;
    return `${plan.name} · ${focus}${time} · up to ${workoutPeakWatts(workout, this.profile.ftp)} W`;
  }

  /** Flattest roads first, so a steady ERG lap is easy to find. */
  private sortedTrainRoutes(ids: readonly string[]) {
    const allowed = new Set(ids);
    return ROUTES.filter((def) => allowed.has(def.id)).sort(
      (a, b) => DIFFICULTY_RANK[a.difficulty] - DIFFICULTY_RANK[b.difficulty] || a.name.localeCompare(b.name),
    );
  }

  private trainRoadCard(def: (typeof ROUTES)[number]): string {
    const route = getRoute(def);
    const on = def.id === this.trainRoute;
    return `
      <button type="button" class="train-road${on ? ' selected' : ''}" data-train-route="${def.id}">
        <span class="route-card-head"><b>${esc(def.name)}</b><span class="badge ${def.difficulty}">${DIFFICULTY_LABEL[def.difficulty]}</span></span>
        <span class="stats">
          <span><small>Distance</small>${(route.length / 1000).toFixed(1)} km</span>
          <span><small>Climbing</small>${Math.round(route.totalAscent)} m</span>
        </span>
      </button>`;
  }

  private viewTrainRoute(): string {
    const picked = this.selectedTrainWorkout();
    if (!picked) {
      return `${this.header('Choose a road')}<div class="panel-body"><p>Pick a workout first.</p></div>`;
    }
    const { plan, workout } = picked;
    const line = this.trainWorkoutLine(plan, workout);
    const region = this.trainRegion ? rideRegion(this.trainRegion) : undefined;
    if (!region) {
      return `
        ${this.header(workout.name, line)}
        <div class="panel-body">
          <p>${esc(workout.blurb)}</p>
          <p class="muted small">Choose a landscape, then a road. The workout stays the same on every road. A flat road keeps your speed steady.</p>
          <div class="region-grid">${this.regionCards()}</div>
        </div>`;
    }
    const roads = this.sortedTrainRoutes(region.routes);
    const road = getRouteDef(this.trainRoute);
    return `
      ${this.header(workout.name, `${line} · ${region.name}`)}
      <div class="panel-body">
        <p>${esc(region.line)}</p>
        <div class="train-roads">
          ${roads.map((def) => this.trainRoadCard(def)).join('')}
        </div>
      </div>
      <div class="panel-foot stack">
        <button class="btn primary big" id="start-train" type="button">Start on ${esc(road.name)}</button>
      </div>`;
  }

  private bindTrainRoute() {
    $$('[data-region]', this.panel).forEach((el) =>
      el.addEventListener('click', () => {
        const region = rideRegion(el.dataset.region ?? '');
        if (!region) return;
        const roads = this.sortedTrainRoutes(region.routes);
        this.trainRegion = region.id;
        if (!roads.some((def) => def.id === this.trainRoute)) this.trainRoute = roads[0]?.id ?? this.trainRoute;
        this.render();
      }),
    );
    $$('[data-train-route]', this.panel).forEach((el) =>
      el.addEventListener('click', () => {
        const id = el.dataset.trainRoute;
        if (!id) return;
        this.trainRoute = id;
        $$('[data-train-route]', this.panel).forEach((card) => card.classList.toggle('selected', card.dataset.trainRoute === id));
        const start = this.panel.querySelector<HTMLButtonElement>('#start-train');
        const name = getRouteDef(id).name;
        if (start) start.textContent = `Start on ${name}`;
      }),
    );
    this.panel.querySelector<HTMLButtonElement>('#start-train')?.addEventListener('click', () => void this.startRide('train'));
  }

  // ---- Garage

  private shownColors(): RiderColors {
    const colors = this.profile.colors;
    return {
      ...colors,
      bike: this.shopPreview.frame ?? colors.bike,
      wheelBrand: this.shopPreview.wheels ?? colors.wheelBrand ?? colors.bike,
    };
  }

  private paintBike() {
    this.world?.setRiderColors([this.shownColors()]);
  }

  private shopRows(kind: ShopKind): string {
    const p = this.profile;
    const equipped = kind === 'frame' ? p.colors.bike : (p.colors.wheelBrand ?? p.colors.bike);
    const owned = new Set(kind === 'frame' ? p.ownedFrames : p.ownedWheels);
    return BRANDS.map((b) => {
      const mine = owned.has(b.id);
      const on = equipped === b.id;
      const looking = this.shopFocus?.kind === kind && this.shopFocus.id === b.id;
      const status = on ? 'Equipped' : mine ? 'Owned' : `${shopCost(kind, b.id)} Coins`;
      const detail = kind === 'frame' ? b.model : wheelLabel(b);
      return `<button type="button" class="shop-row${looking ? ' previewing' : ''}${mine ? '' : ' locked'}" data-shop="${kind}" data-id="${b.id}"><b style="font:${b.font.replace(/\d+px/, '18px')};letter-spacing:${(b.spacing / 48).toFixed(2)}px">${esc(b.name)}</b><span>${esc(detail)}</span><em>${status}</em></button>`;
    }).join('');
  }

  private shopShowcase(): string {
    const focus = this.shopFocus;
    if (!focus) return `<div class="shop-showcase" id="shop-showcase" hidden></div><div class="shop-actions"><button class="btn primary" id="save-garage" type="button">Save look</button></div>`;
    const brand = BRANDS.find((b) => b.id === focus.id)!;
    const owned = (focus.kind === 'frame' ? this.profile.ownedFrames : this.profile.ownedWheels).includes(focus.id);
    const equipped = focus.kind === 'frame'
      ? this.profile.colors.bike === focus.id
      : (this.profile.colors.wheelBrand ?? this.profile.colors.bike) === focus.id;
    const cost = shopCost(focus.kind, focus.id);
    const part = focus.kind === 'frame' ? 'frame' : 'wheels';
    let copy = focus.kind === 'frame' ? `${brand.model}. ${brand.blurb}` : `${wheelLabel(brand)}. These wheels fit any frame.`;
    let action = '';
    if (!owned && this.profile.coins >= cost) action = `<button class="btn primary" id="shop-buy" type="button">Buy</button>`;
    else if (!owned) copy += ` You need ${coinWord(cost - this.profile.coins)} more.`;
    else if (!equipped) action = `<button class="btn primary" id="shop-equip" type="button">Equip</button>`;
    return `
      <div class="shop-showcase" id="shop-showcase">
        <b>${esc(brand.name)} ${part}</b>
        <span class="muted small">${esc(copy)}</span>
      </div>
      <div class="shop-actions">${action}<button class="btn ${action ? '' : 'primary'}" id="save-garage" type="button">Save look</button></div>`;
  }

  private viewGarage(): string {
    const c = this.profile.colors;
    return `
      ${this.header('Equipment', 'Make the rider yours. Changes show live on the bike.')}
      <div class="panel-body">
        <div class="coin-balance"><b>${this.profile.coins}</b><span>Coins</span></div>
        <p class="muted small">One Coin for every full kilometre. Choose a frame or a wheelset to see it on the bike. Buy confirms before the Coins are spent.</p>
        <h3>Frame</h3>
        <div class="shop-list">${this.shopRows('frame')}</div>
        <h3>Wheels</h3>
        <div class="shop-list">${this.shopRows('wheels')}</div>
        <h3>Colours</h3>
        <div class="color-grid">
          ${COLOR_FIELDS.map((f) => `<label class="color-field"><span>${f.label}</span><input type="color" data-color="${f.key}" value="${c[f.key]}" /></label>`).join('')}
        </div>
        <h3>Kit presets</h3>
        <div class="presets">
          ${KIT_PRESETS.map((k, i) => `<button class="preset" data-preset="${i}"><span style="background:${k.colors.jersey}"></span><span style="background:${k.colors.jerseyAccent}"></span><span style="background:${k.colors.frame}"></span>${esc(k.name)}</button>`).join('')}
          <button class="preset" data-preset="random">Random</button>
        </div>
      </div>
      <div class="panel-foot stack">${this.shopShowcase()}</div>`;
  }

  private refreshGarage() {
    const body = this.panel.querySelector('.panel-body');
    const scroll = body?.scrollTop ?? 0;
    this.render();
    const next = this.panel.querySelector('.panel-body');
    if (next) next.scrollTop = scroll;
    this.paintBike();
  }

  private bindGarage() {
    $$<HTMLInputElement>('[data-color]', this.panel).forEach((input) =>
      input.addEventListener('input', () => {
        this.profile.colors = { ...this.profile.colors, [input.dataset.color!]: input.value };
        this.paintBike();
      }),
    );
    $$('[data-shop]', this.panel).forEach((b) =>
      b.addEventListener('click', () => {
        const kind = b.dataset.shop as ShopKind;
        const id = b.dataset.id as BikeBrand;
        this.shopFocus = { kind, id };
        if (kind === 'frame') this.shopPreview.frame = id;
        else this.shopPreview.wheels = id;
        this.refreshGarage();
      }),
    );
    const equip = this.panel.querySelector<HTMLButtonElement>('#shop-equip');
    equip?.addEventListener('click', () => {
      const focus = this.shopFocus;
      if (!focus) return;
      const result = takeFromShop(this.profile, focus.kind, focus.id);
      if (!result.ok) return;
      this.profile = result.profile;
      if (focus.kind === 'frame') this.shopPreview.frame = null;
      else this.shopPreview.wheels = null;
      void this.saveProfile();
      this.refreshGarage();
    });
    const buy = this.panel.querySelector<HTMLButtonElement>('#shop-buy');
    buy?.addEventListener('click', () => this.askToBuy());
    $$('[data-preset]', this.panel).forEach((b) =>
      b.addEventListener('click', () => {
        const id = b.dataset.preset!;
        if (id === 'random') {
          const rnd = () => `#${Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0')}`;
          this.profile.colors = { ...this.profile.colors, jersey: rnd(), jerseyAccent: rnd(), shorts: '#1b1f27', helmet: rnd(), frame: rnd(), shoes: rnd() };
        } else {
          this.profile.colors = { ...this.profile.colors, ...KIT_PRESETS[Number(id)].colors };
        }
        this.paintBike();
        $$<HTMLInputElement>('[data-color]', this.panel).forEach((input) => {
          const value = this.profile.colors[input.dataset.color as keyof RiderColors];
          if (typeof value === 'string') input.value = value;
        });
      }),
    );
    $('#save-garage', this.panel).addEventListener('click', async () => {
      await this.saveProfile();
      toast('Your look has been saved.', 'success');
    });
  }

  /** Ask before spending Coins. The bike is already showing this part. */
  private askToBuy() {
    const focus = this.shopFocus;
    if (!focus) return;
    const brand = BRANDS.find((b) => b.id === focus.id);
    if (!brand) return;
    const cost = shopCost(focus.kind, focus.id);
    const noun = focus.kind === 'frame' ? 'frame' : 'wheels';
    const part = focus.kind === 'frame' ? 'this frame' : 'these wheels';
    this.overlay.innerHTML = `
      <div class="modal glass">
        <h2>Buy ${esc(brand.name)}?</h2>
        <p>Are you sure you want to buy ${part} for <b>${coinWord(cost)}</b>?</p>
        <div class="modal-actions">
          <button class="btn ghost" id="buy-cancel" type="button">Cancel</button>
          <button class="btn primary" id="buy-confirm" type="button">Buy</button>
        </div>
      </div>`;
    this.syncOverlayPointer();
    this.bindOverlayButton('#buy-cancel', () => {
      this.overlay.innerHTML = '';
      this.syncOverlayPointer();
    });
    this.bindOverlayButton('#buy-confirm', () => {
      const result = takeFromShop(this.profile, focus.kind, focus.id);
      this.overlay.innerHTML = '';
      this.syncOverlayPointer();
      if (!result.ok) {
        toast(`You need ${coinWord(result.need)} more.`, 'info');
        this.refreshGarage();
        return;
      }
      this.profile = result.profile;
      if (focus.kind === 'frame') this.shopPreview.frame = null;
      else this.shopPreview.wheels = null;
      void this.saveProfile();
      toast(`You bought the ${brand.name} ${noun}.`, 'success');
      this.refreshGarage();
    });
  }

  // ---- Settings

  private viewSettings(): string {
    const p = this.profile;
    const opts = <T extends string>(entries: [T, string][], value: T) =>
      entries.map(([k, label]) => `<option value="${k}" ${k === value ? 'selected' : ''}>${label}</option>`).join('');
    return `
      ${this.header('Settings')}
      <div class="panel-body form">
        <h3>Profile</h3>
        <label>Name <input id="s-name" value="${esc(p.name)}" maxlength="24" placeholder="Your name" /></label>
        <div class="two">
          <label>Weight (kg) <input id="s-weight" type="number" min="35" max="150" step="0.5" value="${p.weightKg}" /></label>
          <label>FTP (W) <input id="s-ftp" type="number" min="80" max="550" step="1" value="${p.ftp}" /></label>
        </div>
        <p class="muted small">The power you can hold for about an hour. The number you type here is used until you finish the 20-minute FTP test in Training Plans. That test replaces it.</p>
        <h3>Trainer difficulty: <b id="s-diff-label">${p.difficulty}%</b></h3>
        <input id="s-diff" type="range" min="0" max="100" step="5" value="${p.difficulty}" />
        <p class="muted small">How much of the real gradient the trainer simulates. 100% = real feel, 50% = an 8% climb feels like 4%. Speed in the game always uses the real gradient.</p>
        <h3>Graphics</h3>
        <div class="two">
          <label>Quality <select id="s-quality">${opts(Object.entries(QUALITY).map(([k, v]) => [k as GraphicsQuality, v.label]), p.graphics)}</select></label>
          <label>Time of day <select id="s-tod">${opts(Object.entries(ATMOSPHERES).map(([k, v]) => [k as TimeOfDay, v.label]), p.timeOfDay)}</select></label>
        </div>
        <p class="muted small">Medium is a good choice for laptops. Ultra needs a strong graphics card.</p>
        <h3>Sound</h3>
        <div class="sound-rows">
          <label>Volume <input id="s-vol" type="range" min="0" max="1" step="0.05" value="${sound.settings.master}" /></label>
          <label>Music <input id="s-music" type="range" min="0" max="1" step="0.05" value="${sound.settings.music}" /></label>
          <label>Road and crowd <input id="s-fx" type="range" min="0" max="1" step="0.05" value="${sound.settings.effects}" /></label>
          <label class="check"><input id="s-mute" type="checkbox" ${sound.settings.muted ? 'checked' : ''} /> Mute everything</label>
        </div>
        <p class="muted small">Wind and the freewheel follow your speed. Crowds get louder near the top. Sound changes apply at once.</p>
      </div>
      <div class="panel-foot"><button class="btn primary" id="s-save">Save settings</button></div>`;
  }

  private bindSettings() {
    const vol = (id: string, key: 'master' | 'music' | 'effects') =>
      $<HTMLInputElement>(id, this.panel).addEventListener('input', (e) => sound.saveSettings({ [key]: Number((e.target as HTMLInputElement).value) }));
    vol('#s-vol', 'master');
    vol('#s-music', 'music');
    vol('#s-fx', 'effects');
    $<HTMLInputElement>('#s-mute', this.panel).addEventListener('change', (e) => sound.saveSettings({ muted: (e.target as HTMLInputElement).checked }));
    const diff = $<HTMLInputElement>('#s-diff', this.panel);
    diff.addEventListener('input', () => ($('#s-diff-label', this.panel).textContent = `${diff.value}%`));
    $<HTMLSelectElement>('#s-quality', this.panel).addEventListener('change', (e) => {
      this.profile.graphics = (e.target as HTMLSelectElement).value as GraphicsQuality;
      this.world?.setQuality(this.profile.graphics);
    });
    $<HTMLSelectElement>('#s-tod', this.panel).addEventListener('change', (e) => {
      this.profile.timeOfDay = (e.target as HTMLSelectElement).value as TimeOfDay;
      this.world?.setTimeOfDay(this.profile.timeOfDay);
      this.refreshTools();
    });
    $('#s-save', this.panel).addEventListener('click', async () => {
      const weight = Number($<HTMLInputElement>('#s-weight', this.panel).value);
      const ftp = Number($<HTMLInputElement>('#s-ftp', this.panel).value);
      if (!(weight >= 35 && weight <= 150) || !(ftp >= 80 && ftp <= 550)) {
        toast('Please enter a weight between 35-150 kg and an FTP between 80-550 W.', 'error');
        return;
      }
      this.profile.name = $<HTMLInputElement>('#s-name', this.panel).value.trim();
      this.profile.weightKg = weight;
      this.profile.ftp = Math.round(ftp);
      this.profile.difficulty = Number(diff.value);
      await this.saveProfile();
      toast('Settings saved.', 'success');
      this.go('home');
    });
  }

  // ---- Help

  private viewHelp(): string {
    return `
      ${this.header('Help & Setup')}
      <div class="panel-body help">
        <div class="tabs">${HELP_SECTIONS.map((s, i) => `<button class="tab ${i === 0 ? 'active' : ''}" data-tab="${s.id}">${s.title}</button>`).join('')}</div>
        ${HELP_SECTIONS.map((s, i) => `<article class="help-section ${i === 0 ? '' : 'hidden'}" data-section="${s.id}">${s.html}</article>`).join('')}
      </div>`;
  }

  private bindHelp() {
    $$('[data-tab]', this.panel).forEach((t) =>
      t.addEventListener('click', () => {
        $$('[data-tab]', this.panel).forEach((x) => x.classList.toggle('active', x === t));
        $$('[data-section]', this.panel).forEach((s) => s.classList.toggle('hidden', s.dataset.section !== t.dataset.tab));
      }),
    );
  }

  // ---- History

  private async renderHistory() {
    try {
      await syncAccountRides(this.storage);
    } catch (err) {
      console.error('Ride sync failed', err);
    }
    if (this.screen !== 'history') return;
    const [rides, efforts] = await Promise.all([this.storage.listRides(), this.storage.listClimbEfforts()]);
    if (this.screen !== 'history') return;
    this.analyticsRides = rides;
    this.analyticsEfforts = efforts;
    this.paintAnalytics(false);
  }

  private analyticsState(): AnalyticsState {
    return {
      page: this.analyticsPage,
      sortKey: this.analyticsSort,
      sortDesc: this.analyticsSortDesc,
      kind: this.analyticsKind,
      year: this.analyticsYear,
      month: this.analyticsMonthIndex,
      day: this.analyticsDay,
      segmentId: this.analyticsSegment,
      routeId: this.analyticsRouteId,
      range: this.analyticsRange,
      volume: this.analyticsVolume,
      now: new Date(),
    };
  }

  private async paintAnalytics(keepScroll: boolean): Promise<void> {
    if (this.screen !== 'history') return;
    await loadAnalytics();
    if (this.screen !== 'history') return;
    if (this.analyticsPage === 'calendar') await this.ensureMonthSamples();
    if (this.screen !== 'history') return;
    const missingPower = this.analyticsPage === 'power' && this.missingPowerRides().length > 0;
    const scroller = this.panel.querySelector('.panel-body');
    const top = keepScroll ? (scroller?.scrollTop ?? 0) : 0;
    this.panel.innerHTML = `
      ${this.header('Analytics', 'Free rides, training, hill climbs and career stages saved on your account.')}
      <div class="panel-body analytics-body">
        ${an().analyticsHtml(this.analyticsRides, this.analyticsEfforts, this.analyticsState(), {
          ftp: this.profile.ftp,
          weightKg: this.profile.weightKg,
          samples: this.analyticsSamples,
          power: this.ridePowerMap(),
          powerLoading: missingPower,
        })}
      </div>`;
    const next = this.panel.querySelector('.panel-body');
    if (next) next.scrollTop = top;
    this.bindAnalytics();
    if (missingPower) void this.loadRangePower();
  }

  private powerKey(ride: RideSummary, ftpOf: (ride: RideSummary) => number): string {
    return `${ride.id}:${Math.round(ftpOf(ride))}`;
  }

  /** Power data of the saved rides, keyed by ride id only. */
  private ridePowerMap(): Map<string, PowerData> {
    const ftpOf = an().ftpTimeline(this.analyticsRides, this.profile.ftp);
    const out = new Map<string, PowerData>();
    for (const ride of this.analyticsRides) {
      const data = this.analyticsPower.get(this.powerKey(ride, ftpOf));
      if (data) out.set(ride.id, data);
    }
    return out;
  }

  private missingPowerRides(): RideSummary[] {
    const ftpOf = an().ftpTimeline(this.analyticsRides, this.profile.ftp);
    return an()
      .powerRides(this.analyticsRides, this.analyticsRange, new Date())
      .filter((ride) => !this.analyticsPower.has(this.powerKey(ride, ftpOf)));
  }

  /** Reads the samples of every ride in the range once, and keeps only the numbers the Power page needs. */
  private async loadRangePower(): Promise<void> {
    if (this.analyticsPowerLoading) return;
    this.analyticsPowerLoading = true;
    try {
      const ftpOf = an().ftpTimeline(this.analyticsRides, this.profile.ftp);
      for (const ride of this.missingPowerRides()) {
        if (this.screen !== 'history' || this.analyticsPage !== 'power') return;
        const samples = this.analyticsSamples.get(ride.id) ?? (await this.storage.getRideSamples(ride.id)) ?? [];
        this.analyticsPower.set(this.powerKey(ride, ftpOf), an().powerData(samples, ftpOf(ride)));
      }
    } catch (err) {
      console.error('Reading ride power failed', err);
    } finally {
      this.analyticsPowerLoading = false;
    }
    if (this.screen === 'history' && this.analyticsPage === 'power' && !this.missingPowerRides().length) void this.paintAnalytics(true);
  }

  private bindAnalytics(): void {
    $$('[data-analytics]', this.panel).forEach((button) =>
      button.addEventListener('click', () => {
        const page = button.dataset.analytics;
        if (!an().ANALYTICS_PAGES.includes(page as AnalyticsPage)) return;
        if (page === this.analyticsPage) return;
        this.analyticsPage = page as AnalyticsPage;
        this.paintAnalytics(false);
      }),
    );
    $$('[data-kind]', this.panel).forEach((button) =>
      button.addEventListener('click', () => {
        const kind = button.dataset.kind;
        this.analyticsKind = kind === 'free' || kind === 'train' || kind === 'race' || kind === 'career' ? kind : 'all';
        this.paintAnalytics(true);
      }),
    );
    $$('[data-sort]', this.panel).forEach((button) =>
      button.addEventListener('click', () => {
        const key = button.dataset.sort;
        if (!an().RIDE_SORT_KEYS.includes(key as RideSortKey)) return;
        if (this.analyticsSort === key) this.analyticsSortDesc = !this.analyticsSortDesc;
        else {
          this.analyticsSort = key as RideSortKey;
          this.analyticsSortDesc = key !== 'name' && key !== 'type';
        }
        this.paintAnalytics(true);
      }),
    );
    this.panel.querySelector<HTMLSelectElement>('[data-sort-select]')?.addEventListener('change', (event) => {
      const key = (event.target as HTMLSelectElement).value;
      if (!an().RIDE_SORT_KEYS.includes(key as RideSortKey)) return;
      this.analyticsSort = key as RideSortKey;
      this.analyticsSortDesc = key !== 'name' && key !== 'type';
      this.paintAnalytics(true);
    });
    $$('[data-range]', this.panel).forEach((button) =>
      button.addEventListener('click', () => {
        const range = button.dataset.range;
        if (range !== '6w' && range !== '3m' && range !== '6m' && range !== '1y' && range !== 'all') return;
        if (range === this.analyticsRange) return;
        this.analyticsRange = range;
        this.paintAnalytics(true);
      }),
    );
    $$('[data-volume]', this.panel).forEach((button) =>
      button.addEventListener('click', () => {
        const metric = button.dataset.volume;
        if (!an().VOLUME_METRICS.includes(metric as VolumeMetric)) return;
        this.analyticsVolume = metric as VolumeMetric;
        this.paintAnalytics(true);
      }),
    );
    $$('[data-segment]', this.panel).forEach((button) =>
      button.addEventListener('click', () => {
        const menu = button.closest('.finder-menu');
        if (menu instanceof HTMLElement) menu.hidden = true;
        this.analyticsSegment = button.dataset.segment || 'all';
        this.paintAnalytics(true);
      }),
    );
    $$('[data-route]', this.panel).forEach((button) =>
      button.addEventListener('click', () => {
        const menu = button.closest('.finder-menu');
        if (menu instanceof HTMLElement) menu.hidden = true;
        const next = button.dataset.route || '';
        if (next !== this.analyticsRouteId) this.analyticsSegment = 'all';
        this.analyticsRouteId = next;
        this.paintAnalytics(true);
      }),
    );
    $$('[data-cal]', this.panel).forEach((button) =>
      button.addEventListener('click', () => {
        if (button.hasAttribute('disabled')) return;
        if (button.dataset.cal === 'month') {
          this.analyticsDay = null;
          this.paintAnalytics(true);
          return;
        }
        const next = new Date(this.analyticsYear, this.analyticsMonthIndex + (button.dataset.cal === 'prev' ? -1 : 1), 1);
        const today = new Date();
        if (next.getFullYear() > today.getFullYear() || (next.getFullYear() === today.getFullYear() && next.getMonth() > today.getMonth())) return;
        this.analyticsYear = next.getFullYear();
        this.analyticsMonthIndex = next.getMonth();
        this.analyticsDay = null;
        this.paintAnalytics(true);
      }),
    );
    $$('[data-day]', this.panel).forEach((button) =>
      button.addEventListener('click', () => {
        const key = button.dataset.day;
        if (!key) return;
        const [year, month] = key.split('-').map(Number);
        if (!year || !month) return;
        this.analyticsYear = year;
        this.analyticsMonthIndex = month - 1;
        this.analyticsDay = this.analyticsDay === key && !button.dataset.jump ? null : key;
        if (button.dataset.jump) this.analyticsPage = 'calendar';
        this.paintAnalytics(false);
      }),
    );
    $$('[data-ride]', this.panel).forEach((button) =>
      button.addEventListener('click', () => {
        const id = button.dataset.ride;
        const ride = this.analyticsRides.find((item) => item.id === id);
        if (!ride) return;
        const at = new Date(ride.startedAt);
        const key = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
        const sameDay = this.analyticsDay === key;
        this.analyticsDay = key;
        const reveal = () => {
          const card = this.panel.querySelector(`#cal-ride-${cssEscape(id!)}`);
          card?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          card?.classList.add('is-focus');
        };
        if (sameDay) reveal();
        else void this.paintAnalytics(false).then(reveal);
      }),
    );
    this.bindChartTip();
    this.bindFinder();
    if (this.analyticsPage !== 'rides') return;
    const rides = this.analyticsRides;
    $$('[data-fit]', this.panel).forEach((b) =>
      b.addEventListener('click', async () => {
        const id = b.dataset.fit!;
        const ride = rides.find((r) => r.id === id);
        if (!ride) return;
        let fit = await this.storage.getRideFit(id);
        if (!fit) {
          const samples = await this.storage.getRideSamples(id);
          if (samples?.length) fit = await encodeFitLazy(ride, samples);
        }
        if (fit) downloadBytes(fit, rideFileName(ride));
        else toast('No data recorded for this ride.', 'error');
      }),
    );
    $$('[data-more]', this.panel).forEach((button) =>
      button.addEventListener('click', async () => {
        const id = button.dataset.more;
        if (!id) return;
        const row = this.panel.querySelector<HTMLElement>(`#detail-${cssEscape(id)}`);
        if (!row) return;
        const open = row.hasAttribute('hidden');
        row.toggleAttribute('hidden', !open);
        button.setAttribute('aria-expanded', open ? 'true' : 'false');
        button.classList.toggle('is-open', open);
        const label = button.querySelector('span');
        if (label) label.textContent = open ? 'Hide' : 'More details';
        if (!open || row.dataset.ready === '1') return;
        const samples = this.analyticsSamples.get(id) ?? (await this.storage.getRideSamples(id)) ?? [];
        this.analyticsSamples.set(id, samples);
        if (!row.isConnected) return;
        const ride = rides.find((item) => item.id === id);
        const ftp = ride ? an().ftpTimeline(rides, this.profile.ftp)(ride) : this.profile.ftp;
        const trace = an().rideTraceHtml(samples, ftp, this.profile.weightKg);
        const profile = row.querySelector('[data-detail-profile]');
        const power = row.querySelector('[data-detail-power]');
        const extra = row.querySelector('[data-detail-extra]');
        if (profile) profile.innerHTML = trace.profile;
        if (power) power.innerHTML = trace.power;
        if (extra) extra.innerHTML = trace.extra;
        row.dataset.ready = '1';
      }),
    );
    $$('[data-del]', this.panel).forEach((b) =>
      b.addEventListener('click', async () => {
        if (!confirm('Delete this ride from your account?')) return;
        try {
          await deleteAccountRide(this.storage, b.dataset.del!);
        } catch (err) {
          toast((err as Error).message, 'error');
          return;
        }
        void this.renderHistory();
      }),
    );
    $('#backup-export', this.panel).addEventListener('click', async () => {
      const json = await exportBackup(this.storage);
      downloadBytes(json, `CycleBuddy_backup_${new Date().toISOString().slice(0, 10)}.json`, 'application/json');
    });
    $<HTMLInputElement>('#backup-import', this.panel).addEventListener('change', async (e) => {
      const input = e.target as HTMLInputElement;
      const files = [...(input.files ?? [])];
      input.value = '';
      if (!files.length) return;
      try {
        let n = 0;
        for (const file of files) {
          if (file.name.toLowerCase().endsWith('.fit')) {
            const bytes = new Uint8Array(await file.arrayBuffer());
            const { summary, samples } = (await loadFit()).rideFromFit(bytes, file.name);
            await this.storage.saveRide(summary, samples, bytes);
            n += 1;
          } else {
            n += await importBackup(this.storage, await file.text());
            this.profile = this.profileFromSave(await this.storage.getProfile());
          }
        }
        await syncAccountRides(this.storage, { uploadAllLocal: true });
        toast(`Imported ${n} ${n === 1 ? 'ride' : 'rides'}.`, 'success');
        void this.renderHistory();
      } catch (err) {
        toast(`Import failed: ${(err as Error).message}`, 'error');
        void this.renderHistory();
      }
    });
  }

  private async ensureMonthSamples(): Promise<void> {
    const rides = an().ridesInMonth(this.analyticsRides, this.analyticsYear, this.analyticsMonthIndex);
    await Promise.all(
      rides.map(async (ride) => {
        if (this.analyticsSamples.has(ride.id)) return;
        this.analyticsSamples.set(ride.id, (await this.storage.getRideSamples(ride.id)) ?? []);
      }),
    );
  }

  private bindChartTip(): void {
    const tip = this.panel.querySelector<HTMLElement>('.chart-tip');
    if (!tip) return;
    // The panel is transformed and blurred, which traps a fixed tip and clips it.
    for (const old of document.querySelectorAll('body > .chart-tip')) old.remove();
    document.body.appendChild(tip);
    let current: Element | null = null;
    const place = (event: PointerEvent, hit: Element) => {
      const gap = 10;
      const width = tip.offsetWidth;
      const height = tip.offsetHeight;
      const mark = Number(hit.getAttribute('data-x'));
      const svg = hit instanceof SVGGraphicsElement ? hit.ownerSVGElement : null;
      let anchor = event.clientX;
      if (svg && Number.isFinite(mark)) {
        const point = svg.createSVGPoint();
        point.x = mark;
        point.y = 0;
        anchor = point.matrixTransform(svg.getScreenCTM() ?? svg.createSVGMatrix()).x;
      }
      const card = hit.closest('.chart-card')?.getBoundingClientRect();
      const limit = Math.min(window.innerWidth - 8, card ? card.right - 6 : window.innerWidth - 8);
      let x = anchor + gap;
      let y = event.clientY - height - gap;
      if (y < 8) y = event.clientY + gap;
      if (x + width > limit) x = anchor - width - gap;
      tip.style.left = `${Math.max(8, x)}px`;
      tip.style.top = `${Math.max(8, Math.min(y, window.innerHeight - height - 8))}px`;
    };
    const show = (event: Event) => {
      const hit = (event.target as Element | null)?.closest?.('[data-tip]');
      if (!(hit instanceof Element)) {
        tip.hidden = true;
        current?.closest('.chart-slot')?.classList.remove('is-active');
        current = null;
        return;
      }
      if (hit === current && !tip.hidden) return;
      current?.closest('.chart-slot')?.classList.remove('is-active');
      current = hit;
      hit.closest('.chart-slot')?.classList.add('is-active');
      tip.textContent = hit.getAttribute('data-tip') ?? '';
      tip.hidden = false;
      place(event as PointerEvent, hit);
    };
    this.panel.addEventListener('pointerover', show);
    this.panel.addEventListener('pointermove', show);
    this.panel.addEventListener('pointerleave', () => {
      tip.hidden = true;
      current?.closest('.chart-slot')?.classList.remove('is-active');
      current = null;
    });
  }

  private bindFinder(): void {
    const routeInput = this.panel.querySelector<HTMLInputElement>('#route-find');
    const segmentInput = this.panel.querySelector<HTMLInputElement>('#segment-find');
    const routeMenu = this.panel.querySelector<HTMLElement>('#route-menu');
    const segmentMenu = this.panel.querySelector<HTMLElement>('#segment-menu');
    if (!routeInput || !segmentInput || !routeMenu || !segmentMenu) return;
    const filter = (input: HTMLInputElement, menu: HTMLElement) => {
      const query = input.value.trim().toLowerCase();
      menu.querySelectorAll('button').forEach((button) => {
        const name = (button.dataset.name || button.textContent || '').toLowerCase();
        const always = button.dataset.route === '' || button.dataset.segment === 'all';
        button.hidden = !always && query.length > 0 && !name.includes(query);
      });
    };
    const fieldOf = (input: HTMLInputElement) => input.closest('.finder-field');
    const openRoute = () => {
      segmentMenu.hidden = true;
      routeMenu.hidden = false;
      filter(routeInput, routeMenu);
      matchSegments();
    };
    const openSegment = () => {
      routeMenu.hidden = true;
      segmentMenu.hidden = false;
      matchSegments();
    };
    routeInput.addEventListener('focus', () => {
      routeInput.select();
      openRoute();
    });
    const matchSegments = () => {
      const visible = [...routeMenu.querySelectorAll('button')].filter((button) => !button.hidden && button.dataset.route);
      const typed = routeInput.value.trim();
      const only = !typed ? '' : visible.length === 1 ? visible[0].dataset.route || '' : this.analyticsRouteId;
      const query = segmentInput.value.trim().toLowerCase();
      segmentMenu.querySelectorAll('button').forEach((button) => {
        if (button.dataset.segment === 'all') {
          button.hidden = false;
          return;
        }
        const name = (button.dataset.name || button.textContent || '').toLowerCase();
        const onRoute = !only || button.dataset.routeId === only;
        button.hidden = !onRoute || (query.length > 0 && !name.includes(query));
      });
    };
    routeInput.addEventListener('input', () => {
      if (!routeMenu.hidden) {
        filter(routeInput, routeMenu);
        matchSegments();
      }
    });
    segmentInput.addEventListener('focus', () => {
      segmentInput.select();
      openSegment();
    });
    segmentInput.addEventListener('input', () => {
      if (!segmentMenu.hidden) matchSegments();
    });
    $$('[data-finder]', this.panel).forEach((button) =>
      button.addEventListener('click', () => {
        if (button.dataset.finder === 'segment') {
          matchSegments();
          const matches = [...segmentMenu.querySelectorAll('button')].filter((item) => !item.hidden && item.dataset.segment && item.dataset.segment !== 'all');
          if (segmentInput.value.trim() && matches.length === 1) {
            matches[0].click();
            return;
          }
          openSegment();
          return;
        }
        filter(routeInput, routeMenu);
        const matches = [...routeMenu.querySelectorAll('button')].filter((item) => !item.hidden && item.dataset.route);
        if (routeInput.value.trim() && matches.length === 1) {
          matches[0].click();
          return;
        }
        openRoute();
      }),
    );
    this.panel.addEventListener('pointerdown', (event) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (!fieldOf(routeInput)?.contains(target)) routeMenu.hidden = true;
      if (!fieldOf(segmentInput)?.contains(target)) segmentMenu.hidden = true;
    });
  }

  // ---------------------------------------------------------------- onboarding & recovery

  private showOnboarding() {
    this.overlay.innerHTML = `
      <div class="modal glass">
        <h2>Welcome to CycleBuddy</h2>
        <p>Tell us a little about yourself so the climbing physics and AI riders match you.</p>
        <div class="form">
          <label>Name <input id="o-name" maxlength="24" placeholder="Your name" value="${esc(this.profile.name)}" /></label>
          <div class="two">
            <label>Weight (kg) <input id="o-weight" type="number" min="35" max="150" step="0.5" value="${this.profile.weightKg}" /></label>
            <label>FTP (W) <input id="o-ftp" type="number" min="80" max="550" value="${this.profile.ftp}" /></label>
          </div>
          <p class="muted small">FTP is the power you can hold for about an hour. Not sure? 2.5-3.0 W/kg &times; your weight is a good start. You can measure it later with the 20-minute FTP test in Training Plans.</p>
        </div>
        <div class="modal-actions"><button class="btn primary" id="o-save">Let's ride</button></div>
      </div>`;
    $('#o-save', this.overlay).addEventListener('click', async () => {
      const weight = Number($<HTMLInputElement>('#o-weight', this.overlay).value);
      const ftp = Number($<HTMLInputElement>('#o-ftp', this.overlay).value);
      if (!(weight >= 35 && weight <= 150) || !(ftp >= 80 && ftp <= 550)) {
        toast('Please enter a weight between 35-150 kg and an FTP between 80-550 W.', 'error');
        return;
      }
      this.profile.name = $<HTMLInputElement>('#o-name', this.overlay).value.trim();
      this.profile.weightKg = weight;
      this.profile.ftp = Math.round(ftp);
      await this.saveProfile();
      this.overlay.innerHTML = '';
      if (this.pendingPlan) this.go('plan');
      else {
        this.go('help');
        toast('Next: connect your trainer using the guide below.', 'info', 6000);
      }
    });
  }

  /** Rides saved before accounts lived only in this browser. Drop that history once. */
  private async forgetLocalRidesOnce(): Promise<void> {
    const key = 'cb-local-rides-cleared';
    if (localStorage.getItem(key)) return;
    await this.storage.clearRideHistory();
    localStorage.setItem(key, '1');
  }

  private async checkRecovery() {
    const snap = await this.storage.getActiveRide();
    if (!snap || snap.samples.length < 60) {
      if (snap) {
        const distanceM = snap.samples.at(-1)?.distance ?? snap.summary.distanceM;
        // Clear first: a reload between the two must not pay the same ride twice.
        await this.storage.clearActiveRide();
        const earned = await this.grantCoins(distanceM);
        if (earned > 0) toast(`That ride was not saved. You earned ${coinWord(earned)}.`, 'info');
      }
      return;
    }
    this.overlay.innerHTML = `
      <div class="modal glass">
        <h2>Unfinished ride found</h2>
        <p>It looks like your last ride (${esc(snap.summary.title)}, ${formatDuration(snap.samples.length)}) was not finished. Save it to your history?</p>
        <div class="modal-actions">
          <button class="btn ghost" id="r-discard">Discard</button>
          <button class="btn primary" id="r-save">Save ride</button>
        </div>
      </div>`;
    $('#r-discard', this.overlay).addEventListener('click', async () => {
      const distanceM = snap.samples.at(-1)?.distance ?? snap.summary.distanceM;
      await this.storage.clearActiveRide();
      const earned = await this.grantCoins(distanceM);
      this.overlay.innerHTML = '';
      if (earned > 0) toast(`Ride discarded. You earned ${coinWord(earned)}.`, 'success');
    });
    $('#r-save', this.overlay).addEventListener('click', async () => {
      const s = snap.summary;
      const summary = summarizeSamples(s.id, new Date(s.startedAt), snap.samples, {
        mode: s.mode, routeId: s.routeId, routeName: s.routeName, climbId: s.climbId, title: `${s.title} (recovered)`, laps: s.laps,
      });
      await this.storage.saveRide(summary, snap.samples, await encodeFitLazy(summary, snap.samples));
      try {
        await publishRide(this.storage, summary.id);
      } catch (err) {
        console.error(err);
      }
      await this.storage.clearActiveRide();
      const earned = await this.grantCoins(summary.distanceM);
      this.overlay.innerHTML = '';
      toast(earned > 0 ? `Ride recovered and saved. You earned ${coinWord(earned)}.` : 'Ride recovered and saved.', 'success');
    });
  }

  private async saveProfile() {
    this.profile.updatedAt = new Date().toISOString();
    await this.storage.saveProfile(this.profile);
    this.devices.riderWeightKg = this.profile.weightKg;
    await this.publishProfile();
  }

  /** Send the local profile, then keep whatever the account decided was the fuller garage. */
  private async publishProfile(): Promise<void> {
    const stored = await pushAccountProfile(this.profile);
    if (!stored) return;
    const merged = mergeAccountProfile(this.profile, stored, true);
    if (riderRecordKey(merged.profile) === riderRecordKey(this.profile)) return;
    this.profile = merged.profile;
    await this.storage.saveProfile(this.profile);
    this.devices.riderWeightKg = this.profile.weightKg;
    this.world?.setRiderColors([this.profile.colors]);
    if (this.screen === 'garage') this.refreshGarage();
  }

  /**
   * Coins and the equipped kit live on the account.
   * A computer that already has them uploads. A new computer downloads.
   * A fresh default does not replace a garage that is already saved.
   */
  private async syncAccountProfile(hadLocal: boolean): Promise<boolean> {
    const remote = await fetchAccountProfile();
    if (!remote.signedIn) return false;
    if (!remote.profile && !hadLocal) return false;
    const merged = mergeAccountProfile(this.profile, remote.profile, hadLocal);
    const before = riderRecordKey(this.profile);
    this.profile = merged.profile;
    if (riderRecordKey(this.profile) !== before) await this.storage.saveProfile(this.profile);
    if (merged.upload) await this.publishProfile();
    return remote.profile != null;
  }

  /** Merge a stored profile. A save from before Coins keeps the bike it already used. */
  private profileFromSave(saved: Profile | null): Profile {
    if (!saved) return settleEquipment(defaultProfile());
    const merged = { ...defaultProfile(), ...saved, colors: { ...DEFAULT_COLORS, ...saved.colors } };
    if (!Array.isArray(saved.ownedFrames)) delete (merged as Partial<Profile>).ownedFrames;
    if (!Array.isArray(saved.ownedWheels)) delete (merged as Partial<Profile>).ownedWheels;
    if (typeof saved.coins !== 'number') delete (merged as Partial<Profile>).coins;
    if (!saved.colors?.wheelBrand) delete merged.colors.wheelBrand;
    if (!RIDE_CAMERAS.includes(merged.camera)) merged.camera = 'chase';
    if (merged.map !== 'ahead' && merged.map !== 'wide' && merged.map !== 'loop') merged.map = 'ahead';
    return settleEquipment(withCurrentDefaultBike(merged as Profile, saved));
  }

  /** Brake while B is held or the Brake row is pressed, and only during a ride. */
  private applyBrake(): void {
    this.braking = (this.brakeKey || this.brakePointer) && this.session?.state === 'riding';
    this.hud.setBrake(this.braking);
  }

  private releaseBrake(): void {
    this.brakeKey = false;
    this.brakePointer = false;
    this.applyBrake();
  }

  /** Restore the camera and map from the last ride. */
  private applySavedView(): void {
    const camera = RIDE_CAMERAS.indexOf(this.profile.camera);
    this.cameraIndex = camera < 0 ? 0 : camera;
    this.hud.setMap(this.profile.map);
    this.refreshTools();
  }

  private refreshTools(): void {
    const camera = RIDE_CAMERAS[this.cameraIndex] ?? 'chase';
    this.hud.setTools(camera, this.profile.timeOfDay, this.hud.mapMode());
    const riding = this.session !== null && this.session.config.mode !== 'race';
    this.hud.setReverse(riding, this.session?.canTurnAround() ?? false);
  }

  private cycleCamera(): void {
    if (!this.session || !this.world) return;
    this.cameraIndex = (this.cameraIndex + 1) % RIDE_CAMERAS.length;
    const camera: RideCamera = RIDE_CAMERAS[this.cameraIndex];
    this.world.cameraMode = camera;
    this.profile.camera = camera;
    this.resetLook();
    this.world.snapCamera();
    toast(CAMERA_LABEL[camera], 'info', 1200);
    this.refreshTools();
    void this.saveProfile();
  }

  private cycleTime(): void {
    if (!this.world) return;
    const keys = Object.keys(ATMOSPHERES) as TimeOfDay[];
    const at = keys.indexOf(this.profile.timeOfDay);
    this.profile.timeOfDay = keys[(at < 0 ? 0 : at + 1) % keys.length];
    this.world.setTimeOfDay(this.profile.timeOfDay);
    toast(ATMOSPHERES[this.profile.timeOfDay].label, 'info', 1500);
    this.refreshTools();
    void this.saveProfile();
  }

  private cycleMap(): void {
    if (!this.session) return;
    const label = this.hud.toggleMap();
    this.profile.map = this.hud.mapMode();
    toast(label, 'info', 1200);
    this.refreshTools();
    void this.saveProfile();
  }

  // ---------------------------------------------------------------- rides

  private async startRide(mode: SessionMode) {
    if (this.loading) return;
    const launch = mode === 'race' ? this.pendingLaunch : null;
    if (!this.devices.hasTrainer) {
      this.overlay.innerHTML = `
        <div class="modal glass">
          <h2>No trainer connected</h2>
          <p>Connect any Bluetooth smart trainer (Wahoo, Elite, Saris, Garmin, Tacx and others that use FTMS). An older Tacx that only speaks FE-C works too. Or ride with the keyboard-controlled virtual trainer.</p>
          <div class="modal-actions">
            <button class="btn ghost" id="m-cancel">Cancel</button>
            <button class="btn ghost" id="m-virtual">Use virtual trainer</button>
            <button class="btn primary" id="m-connect">Connect trainer</button>
          </div>
        </div>`;
      $('#m-cancel', this.overlay).addEventListener('click', () => {
        this.pendingLaunch = null;
        this.overlay.innerHTML = '';
      });
      $('#m-virtual', this.overlay).addEventListener('click', () => {
        this.devices.useVirtualTrainer(Math.round(this.profile.ftp * 0.7));
        this.overlay.innerHTML = '';
        void this.startRide(mode);
      });
      $('#m-connect', this.overlay).addEventListener('click', async () => {
        await this.devices.connectTrainer();
        if (this.devices.hasTrainer) {
          this.overlay.innerHTML = '';
          void this.startRide(mode);
        }
      });
      return;
    }

    if (!launch && (mode === 'race' || mode === 'free')) {
      // Perf: real-road tracks are fetched on demand (routes/real/build.ts). The menus already
      // fetched them, so this is normally instant; it guards a ride started any other way.
      this.loading = true;
      try {
        await (mode === 'race' ? ensureAllTracks() : ensureTrack(this.selectedRoute));
      } catch {
        toast('Could not load that road. Check the connection and try again.', 'error');
        return;
      } finally {
        this.loading = false;
      }
    }
    let route: Route;
    let climb: Climb | undefined;
    let workout: ActiveWorkout | undefined;
    if (launch) {
      route = launch.route;
      climb = launch.climb;
    } else if (mode === 'race') {
      const found = this.allClimbs().find((c) => c.climb.id === this.selectedClimb)!;
      route = found.route;
      climb = found.climb;
    } else if (mode === 'train') {
      const plan = planById(this.selectedPlan);
      const found = plan?.weeks.flatMap((week) => week.workouts).find((item) => item.id === this.selectedWorkout);
      if (!plan || !found) return;
      workout = activateWorkout(plan, found);
      route = getRoute(getRouteDef(this.trainRoute));
    } else {
      route = getRoute(this.defById(this.selectedRoute));
    }
    this.loading = true;
    try {
      const writing: RoadWriting | undefined = mode === 'race'
        ? {
            dir: launch?.plan.dir === -1 ? -1 : 1,
            from: launch ? launch.plan.startS : climb?.start,
            to: launch ? launch.plan.finishS : climb?.end,
          }
        : undefined;
      await this.presentRideLoad(route, climb, mode === 'free' && this.reverseRoutes.has(route.def.id), writing);
      const starts = routeStarts(route);
      const session = new RideSession({
        mode,
        route,
        climb,
        workout,
        aiCount: this.aiCount,
        topWkg: this.aiTop,
        bottomWkg: this.aiBottom,
        profile: { ...this.profile, colors: launch ? launch.playerColors : { ...this.profile.colors } },
        career: launch ? { title: launch.title, road: launch.plan, field: launch.field, playerBody: launch.playerBody, leaders: launch.leaders } : undefined,
        startS: mode === 'free' ? starts[Math.min(this.startIndex, starts.length - 1)].s : mode === 'train' ? 0 : undefined,
        startDirection: mode === 'free' && this.reverseRoutes.has(this.selectedRoute) ? -1 : undefined,
        buddy: mode === 'free' && this.buddyOn
          ? { flat: this.buddyFlat, hill: this.buddyHill, mountain: this.buddyMountain }
          : undefined,
      });
      this.quickRide = !!launch && 'quick' in launch;
      this.finishSting = false;
      this.roadAhead.best = null;
      if (mode === 'race' && climb && !launch) {
        const id = climb.id;
        void this.storage.listClimbEfforts().then((list) => {
          const times = list.filter((e) => e.climbId === id).map((e) => e.timeSec);
          if (times.length && this.session === session) this.roadAhead.best = Math.min(...times);
        });
      }
      this.afterRide = launch ? (this.quickRide ? 'pro' : 'career') : mode === 'train' ? 'plan' : mode === 'race' ? 'race' : 'home';
      this.pendingLaunch = null;
      this.seenEfforts = 0;
      void this.storage.listClimbEfforts().then((list) => {
        this.segmentBests.clear();
        for (const e of list) {
          const prev = this.segmentBests.get(e.climbId);
          if (prev === undefined || e.timeSec < prev) this.segmentBests.set(e.climbId, e.timeSec);
        }
      });
      session.onFinish = () => {
        if (session.config.mode === 'train') void this.finishRide();
        else void this.onRaceFinished();
      };
      session.onLine = () => { void this.onTimeTrialLine(); };
      session.onWatched = () => { void this.afterFinishWatch(); };
      this.session = session;
      this.world!.setRiderColors(session.sim.racers.map((r) => r.colors));
      this.world!.setTrafficEnabled(mode !== 'race');
      this.world!.setRaceClimb(mode === 'race' ? climb ?? null : null, launch?.crowd ?? 'normal');
      const sprints = mode === 'race' ? (launch?.plan.features ?? []).filter((feature) => feature.kind === 'sprint').map((feature) => ({ s: feature.s, name: feature.name })) : [];
      this.world!.setPrimeArches(sprints, launch?.plan.dir === -1 ? -1 : 1);
      this.world!.cameraMode = RIDE_CAMERAS[this.cameraIndex];
      this.hud.setMap(this.profile.map);
      this.refreshTools();
      this.world!.snapCamera();
      this.hud.show(true);
      this.ui.classList.add('riding');
      this.panel.innerHTML = '';
      this.autosaveTimer = 0;
      void this.requestWakeLock();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      this.dismissRideLoad();
      sound.setMusic(mode === 'race' ? 'ride' : 'off');
      if (mode === 'race') sound.play('startHorn');
      if (mode === 'train') toast('ERG is on. Arrow keys nudge the target by 1%. Press E and the road sets the resistance.', 'info', 5200);
    } catch (err) {
      console.error(err);
      this.abortRideLoad();
      if (!this.session) toast('The road could not be loaded.', 'error');
    }
  }

  private async requestWakeLock() {
    try {
      this.wakeLock = (await navigator.wakeLock?.request('screen')) ?? null;
    } catch {
      this.wakeLock = null;
    }
  }

  private showPause() {
    const s = this.session;
    if (!s) return;
    this.releaseLook();
    s.pause();
    // The session stops writing to the trainer while paused, so leave it on a flat road.
    this.devices.releaseToFlat();
    const trial = s.config.career?.road.timeTrial === true;
    const clockTime = trial ? s.sim.ownClock(s.player) : s.config.mode === 'race' ? s.sim.time : s.rideTime;
    this.overlay.innerHTML = `
      <div class="modal pause" role="dialog" aria-label="Paused">
        <header class="pause-head">
          <h2>Paused</h2>
          <span class="muted">Esc to ride on</span>
        </header>
        <dl class="pause-stats">
          <div><dt>Time</dt><dd>${formatDuration(clockTime)}</dd></div>
          <div><dt>Distance</dt><dd>${(s.distance / 1000).toFixed(2)}<small>km</small></dd></div>
          <div><dt>Avg power</dt><dd>${Math.round(s.avgPower)}<small>W</small></dd></div>
        </dl>
        <label class="pause-diff">
          <span>Trainer difficulty</span>
          <input id="p-diff" type="range" min="0" max="100" step="5" value="${s.config.profile.difficulty}" />
          <b id="p-diff-label">${s.config.profile.difficulty}%</b>
        </label>
        ${s.config.mode === 'train' ? `<label class="pause-erg"><input type="checkbox" id="p-erg" ${s.erg ? 'checked' : ''}/><span><b>ERG mode</b> The trainer holds the target. Bias ${Math.round(s.ergBias * 100)}%, arrow keys change it by 1%. Difficulty applies when ERG is off.</span></label>` : ''}
        <div class="pause-devices">${devicesHtml(this.devices.status, this.devices.isVirtual)}</div>
        <div class="pause-actions">
          <button class="pause-discard" type="button" id="p-discard">Discard ride</button>
          <button class="btn" type="button" id="p-finish">${s.config.mode === 'race' ? 'Abandon & save' : 'Finish & save'}</button>
          <button class="btn primary" type="button" id="p-resume">Resume</button>
        </div>
      </div>`;
    const diff = $<HTMLInputElement>('#p-diff', this.overlay);
    diff.addEventListener('input', () => {
      s.config.profile.difficulty = Number(diff.value);
      this.profile.difficulty = Number(diff.value);
      $('#p-diff-label', this.overlay).textContent = `${diff.value}%`;
    });
    diff.addEventListener('change', () => void this.saveProfile());
    const erg = this.overlay.querySelector<HTMLInputElement>('#p-erg');
    erg?.addEventListener('change', () => {
      s.erg = erg.checked;
      if (!s.erg) this.devices.setErgWatts(null);
    });
    // Delegated, so the read-outs can re-render while the dialog is open.
    $('.pause-devices', this.overlay).addEventListener('click', (e) => {
      const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
      if (!act) return;
      e.preventDefault();
      e.stopPropagation();
      this.onDeviceAction(act);
    });
    this.bindOverlayButton('#p-resume', () => this.resume());
    this.bindOverlayButton('#p-finish', () => void this.finishRide());
    this.bindOverlayButton('#p-discard', () => {
      if (!confirm('Discard this ride? It will not be saved. Coins for each full kilometre are kept.')) return;
      const distance = this.session?.distance ?? 0;
      void this.discardRide(distance);
    });
    this.syncOverlayPointer();
  }

  /** Keep the 3D view from taking presses while a dialog is open. */
  private syncOverlayPointer(): void {
    // Perf: runs every frame. Check for a child instead of serializing the overlay's HTML, and touch the
    // canvas only when the state changes (releaseLook clears overlayOpen when it sets the class itself).
    const open = this.overlay.firstChild !== null;
    if (open === this.overlayOpen) return;
    this.overlayOpen = open;
    this.canvas.classList.toggle('ui-open', open);
    this.canvas.style.pointerEvents = open ? 'none' : '';
  }

  /**
   * A press on the pause dialog. The scene can still be the event target, so the
   * button is found from the cursor position as well as from the event.
   */
  private onOverlayPointer(e: Event): void {
    if (!this.overlay.innerHTML) return;
    if (e.type === 'pointerup' && (e as PointerEvent).button !== 0) return;
    const button = this.overlayButtonAt(e);
    if (!button) return;
    e.preventDefault();
    e.stopPropagation();
    button.click();
  }

  private overlayButtonAt(e: Event): HTMLButtonElement | null {
    const direct = e.target instanceof Element ? e.target.closest('button') : null;
    if (direct instanceof HTMLButtonElement && this.overlay.contains(direct)) return direct;
    const pe = e as PointerEvent;
    if (!Number.isFinite(pe.clientX) || !Number.isFinite(pe.clientY)) return null;
    this.syncOverlayPointer();
    for (const node of document.elementsFromPoint(pe.clientX, pe.clientY)) {
      if (!(node instanceof Element) || node === this.canvas) continue;
      const hit = node.closest('button');
      if (hit instanceof HTMLButtonElement && this.overlay.contains(hit)) return hit;
    }
    return null;
  }

  private bindOverlayButton(sel: string, fn: () => void): void {
    $(sel, this.overlay).addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (performance.now() < this.overlayIgnoreUntil) return;
      // Hold through a blocking confirm(). A short window afterwards swallows the
      // extra click the browser sends for the same press once the dialog closes.
      this.overlayIgnoreUntil = Number.POSITIVE_INFINITY;
      try {
        fn();
      } finally {
        this.overlayIgnoreUntil = performance.now() + 300;
      }
    });
  }

  private resume() {
    this.overlay.innerHTML = '';
    this.syncOverlayPointer();
    // The next update sends the grade or ERG target again.
    this.devices.resumeControl();
    this.session?.resume();
  }

  private async onRaceFinished() {
    const s = this.session;
    if (!s) return;
    this.showFinishSplash(s);
    await this.holdSplash();
    if (this.session === s && s.state === 'finished') await this.finishRide();
  }

  /** Time trial: place and time first, then the finish line if riders are still behind. */
  private async onTimeTrialLine() {
    const s = this.session;
    if (!s) return;
    this.showFinishSplash(s);
    await this.holdSplash();
    if (this.session !== s) return;
    this.clearFinishSplash();
    s.beginFinishWatch();
    if (this.world) {
      this.savedCamera = this.world.cameraMode;
      this.world.cameraMode = 'aerial';
      this.world.snapCamera();
    }
    this.hud.show(true);
  }

  private async afterFinishWatch() {
    const s = this.session;
    if (!s || !this.world) return;
    if (this.savedCamera) this.world.cameraMode = this.savedCamera;
    this.savedCamera = null;
    s.watchingFinish = false;
    await this.finishRide();
  }

  private holdSplash(): Promise<void> {
    return new Promise((resolve) => {
      let settled = false;
      let timer = 0;
      const finish = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        this.overlay.removeEventListener('pointerdown', finish);
        resolve();
      };
      timer = window.setTimeout(finish, 5200);
      this.overlay.addEventListener('pointerdown', finish);
    });
  }

  private clearFinishSplash(): void {
    this.overlay.classList.remove('finish-splash');
    this.overlay.innerHTML = '';
    this.syncOverlayPointer();
  }

  /** Place and time, full screen, while the rider keeps rolling through the banner. */
  private showFinishSplash(s: RideSession) {
    this.releaseLook();
    const st = s.sim.standings();
    const place = st.indexOf(s.player) + 1;
    // Time trials and hill-climbs are timed from each rider's own start crossing.
    const p = s.player;
    const chip = p.finishTime != null && p.startTime != null && (s.config.career?.road.timeTrial ?? false) ? p.finishTime - p.startTime : null;
    const time = formatDuration(p.officialTime ?? chip ?? p.finishTime ?? s.rideTime);
    this.overlay.classList.add('finish-splash');
    this.hud.show(false);
    this.overlay.innerHTML = `
      <div class="finish-splash-card">
        <small>${esc(s.config.climb?.name ?? 'Summit')}</small>
        <div class="place">${place}<span>${ordinal(place)}</span></div>
        <span class="of">of ${st.length}</span>
        <span class="time">${time}</span>
      </div>`;
  }

  private announceSegments(s: RideSession): void {
    while (this.seenEfforts < s.newEfforts.length) {
      const e = s.newEfforts[this.seenEfforts];
      this.seenEfforts++;
      const best = this.segmentBests.get(e.climbId);
      if (best === undefined || e.timeSec < best - 0.05) {
        toast(`${e.climbName} ${formatDuration(e.timeSec)} — new best`, 'success', 4500);
        this.segmentBests.set(e.climbId, e.timeSec);
      } else if (e.timeSec > best + 0.5) {
        toast(`${e.climbName} ${formatDuration(e.timeSec)} · ${formatDuration(e.timeSec - best)} off your best`, 'info', 4500);
      } else {
        toast(`${e.climbName} ${formatDuration(e.timeSec)}`, 'info', 3500);
      }
    }
  }

  private async finishRide() {
    const s = this.session;
    if (!s || this.finishing) return;
    this.finishing = true;
    this.devices.releaseToFlat();
    s.coasting = false;
    s.pause();
    // A career stage left before the line is not counted, so there is nothing to fast-forward.
    if (s.config.mode === 'race' && !(s.config.career && s.player.finishTime == null)) {
      s.sim.simulateToEnd();
      const clock = s.player.finishTime ?? s.sim.time;
      const dir = s.sim.raceDir();
      const trial = !!s.config.career?.road.timeTrial;
      for (const r of s.sim.racers) {
        if (r.finishTime != null) continue;
        const left = Math.max(0, (s.sim.finishLine - r.s) * dir);
        const arrival = s.sim.time + left / 7 + 30;
        r.finishTime = trial ? Math.max(1, arrival - r.ttStart) : clock + left / 7 + 30;
        r.officialTime = r.finishTime;
      }
    }
    this.careerNext = false;
    this.careerSheets = null;
    this.careerSeason = null;
    if (s.config.career && !this.quickRide && s.player.finishTime != null) {
      const result = this.career.commit(this.careerRows(s));
      this.careerNext = result.another;
      this.careerSheets = result.classifications;
      this.careerSeason = result.season;
      if (result.headline) toast(result.headline, 'success', 5200);
    }
    const summary = s.summary();
    const samples = s.recorder.samples;
    let saved: 'account' | 'local' | false = false;
    if (samples.length >= 10) {
      const fit = await encodeFitLazy(summary, samples);
      await this.storage.saveRide(summary, samples, fit);
      const efforts = [...s.newEfforts];
      const climb = s.config.climb;
      if (s.config.mode === 'race' && climb && s.player.finishTime !== null && !s.config.career) {
        efforts.push({
          id: uuid(),
          climbId: climb.id,
          climbName: climb.name,
          routeId: s.route.def.id,
          routeName: s.route.def.name,
          lengthM: climb.length,
          rideId: summary.id,
          createdAt: new Date().toISOString(),
          timeSec: s.player.finishTime,
          avgPower: summary.avgPower,
          wkg: summary.avgPower / s.config.profile.weightKg,
        });
      }
      for (const e of efforts) await this.storage.saveClimbEffort({ ...e, rideId: summary.id });
      try {
        await publishRide(this.storage, summary.id);
        saved = 'account';
      } catch (err) {
        console.error(err);
        saved = 'local';
      }
      const estimate = summary.workout?.ftpKind === 'twenty' ? summary.workout.ftpEstimate : null;
      if (estimate != null && ftpInRange(estimate)) {
        this.profile.ftp = estimate;
        await this.saveProfile();
      }
    }
    await this.storage.clearActiveRide();
    const earned = await this.grantCoins(summary.distanceM);
    this.showResults(s, summary, saved, earned);
  }

  /** One Coin per full kilometre, whether or not the ride is saved. */
  private async grantCoins(distanceM: number): Promise<number> {
    const earned = coinsForDistance(distanceM);
    if (earned > 0) {
      this.profile.coins += earned;
      await this.saveProfile();
    }
    return earned;
  }

  private async discardRide(distanceM: number) {
    await this.storage.clearActiveRide();
    const earned = await this.grantCoins(distanceM);
    this.endSession();
    if (earned > 0) toast(`Ride discarded. You earned ${coinWord(earned)}.`, 'success');
  }

  private ftpResultNote(workout: RideSummary['workout'], saved: boolean, stoppedRamp = false): string {
    if (!workout) return '';
    if (workout.ftpKind === 'twenty') {
      if (workout.ftpEstimate == null) return '<p>The 20 minutes were not finished, so your FTP is unchanged.</p>';
      const average = workout.ftpAverage ?? workout.ftpEstimate;
      if (!saved) return `<p>You averaged <b>${average} W</b> for 20 minutes, which comes out as <b>${workout.ftpEstimate} W</b>. The ride was not saved, so your FTP stays ${this.profile.ftp} W.</p>`;
      if (this.profile.ftp === workout.ftpEstimate) {
        const was = workout.previousFtp;
        const change = was != null && was !== workout.ftpEstimate ? ` It was ${was} W.` : '';
        return `<p>You averaged <b>${average} W</b> for 20 minutes. FTP is 95% of that average: <b>${workout.ftpEstimate} W</b>. That is your FTP now.${change}</p>`;
      }
      return `<p>You averaged <b>${average} W</b> for 20 minutes, which comes out as <b>${workout.ftpEstimate} W</b>. That is outside 80–550 W, so your FTP stays ${this.profile.ftp} W. The test is still saved.</p>`;
    }
    if (workout.ftpEstimate == null) return '';
    const how = stoppedRamp ? 'You stopped while the ramp was still rising.' : 'You held the whole ramp.';
    return `<p>${how} Estimated FTP is 75% of your best minute of power: <b>${workout.ftpEstimate} W</b>.</p>`;
  }

  private showResults(s: RideSession, summary: RideSummary, saved: 'account' | 'local' | false, earned = 0) {
    this.releaseLook();
    this.overlay.classList.remove('finish-splash');
    this.hud.show(true);
    const race = s.config.mode === 'race';
    const train = s.config.mode === 'train';
    const workout = summary.workout;
    let raceStage = '';
    let raceClasses = '';
    const hill = race && !s.config.career;
    if (race) {
      const st = s.sim.standings();
      const me = st.indexOf(s.player);
      // Your teammates get their own highlight, so you can find them in the lists.
      const myTeam = s.config.career ? this.career.state?.teamId ?? '' : '';
      const clockOf = (r: (typeof st)[number]) => r.officialTime ?? r.finishTime;
      const winner = clockOf(st[0]) ?? 0;
      const rows = st
        .map((r, i) => ({ r, i }))
        .filter(({ i }) => hill || s.config.career || i < 10 || Math.abs(i - me) <= 2)
        .map(({ r, i }) => {
          const time = clockOf(r) !== null ? formatDuration(clockOf(r) ?? 0) : 'DNF';
          const gap = clockOf(r) !== null && i > 0 ? (Math.abs((clockOf(r) ?? 0) - winner) < 0.05 ? 's.t.' : `+${formatDuration((clockOf(r) ?? 0) - winner)}`) : '';
          const side = r.isPlayer ? '' : s.config.career ? teamCode(r.team) : r.country;
          const name = r.isPlayer ? (this.profile.name || r.name) : r.name;
          const mate = !!myTeam && !r.isPlayer && r.team === myTeam;
          return `<tr class="${r === s.player ? 'me' : mate ? 'teammate' : ''}"><td class="pos">${i + 1}</td><td class="rider" title="${esc(name)}"><span class="dot" style="background:${r.colors.jersey}"></span>${esc(name)}</td><td>${esc(side)}</td><td class="num">${time}</td><td class="num">${gap}</td></tr>`;
        })
        .join('');
      const place = s.player.finishTime !== null ? `You finished <b>${me + 1}${ordinal(me + 1)}</b> of ${st.length}` : 'You did not finish';
      const sideHead = s.config.career ? 'Team' : '';
      raceStage = `<section class="race-stage"><h3>${place}</h3><div class="race-scroll"><table class="standings times"><thead><tr><th class="pos">#</th><th class="rider">Rider</th><th${sideHead ? '' : ' aria-label="Country"'}>${sideHead}</th><th class="num">Time</th><th class="num">Gap</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
      const sheets = s.config.career ? this.careerSheets : null;
      const classTable = (title: string, list: { riderId: string; name: string; teamId: string; value: number }[], unit: 'time' | 'pts') => {
        const leader = list[0]?.value ?? 0;
        const body = list.map((row, i) => {
          const value = unit === 'time' ? formatDuration(row.value) : String(row.value);
          const gap = unit === 'time' && i > 0 ? (Math.abs(row.value - leader) < 0.05 ? 's.t.' : `+${formatDuration(row.value - leader)}`) : '';
          const gapCell = unit === 'time' ? `<td class="num">${gap}</td>` : '';
          const rowClass = row.riderId === 'player' ? 'me' : myTeam && row.teamId === myTeam ? 'teammate' : '';
          return `<tr class="${rowClass}"><td class="pos">${i + 1}</td><td class="rider" title="${esc(row.name)}">${esc(row.name)}</td><td>${esc(teamCode(row.teamId))}</td><td class="num">${value}</td>${gapCell}</tr>`;
        }).join('') || `<tr><td class="empty" colspan="${unit === 'time' ? 5 : 4}">No points yet</td></tr>`;
        const gapHead = unit === 'time' ? '<th class="num">Gap</th>' : '';
        return `<section class="race-class"><h3>${title}</h3><div class="race-scroll"><table class="standings ${unit === 'time' ? 'times' : 'points'}"><thead><tr><th class="pos">#</th><th class="rider">Rider</th><th>Team</th><th class="num">${unit === 'time' ? 'Time' : 'Pts'}</th>${gapHead}</tr></thead><tbody>${body}</tbody></table></div></section>`;
      };
      if (sheets) {
        raceClasses = `<section class="race-classes"><h3>Standings after stage ${sheets.done} of ${sheets.stages}</h3><div class="finish-classes">${classTable('Time', sheets.time, 'time')}${classTable('Sprint', sheets.sprint, 'pts')}${classTable('Mountains', sheets.mountains, 'pts')}</div></section>`;
      }
    }
    const km = (summary.distanceM / 1000).toFixed(2);
    const stat = (label: string, value: string, unit = '') => `<div><small>${label}</small><b>${value}${unit ? `<small>${unit}</small>` : ''}</b></div>`;
    const raceStats = `<div class="race-stats">${stat('Time', formatDuration(summary.durationSec))}${stat('Distance', km, 'km')}${stat('Elevation', `+${Math.round(summary.ascentM)}`, 'm')}${stat('Avg power', String(Math.round(summary.avgPower)), 'W')}${stat('Avg speed', summary.avgSpeedKmh.toFixed(1), 'km/h')}${stat('Norm. power', summary.normalizedPower > 0 ? String(Math.round(summary.normalizedPower)) : '--', summary.normalizedPower > 0 ? 'W' : '')}${stat('Avg HR', summary.avgHeartRate ? String(Math.round(summary.avgHeartRate)) : '--', summary.avgHeartRate ? 'bpm' : '')}${stat('Coins', String(earned))}</div>`;
    const newPbs = s.newEfforts.length ? `<p>Segments: ${s.newEfforts.map((e) => `${esc(e.climbName)} ${formatDuration(e.timeSec)}`).join(', ')}</p>` : '';
    const earnedLine = `<p>You earned <b>${coinWord(earned)}</b>.</p>`;
    const workoutLine = train && workout ? `<p>${workout.compliance == null ? 'Workout saved.' : `You held the target on <b>${Math.round(workout.compliance)}%</b> of the steady efforts.`} ${workout.completed ? 'It is ticked off on the plan.' : 'It stays unticked, because the ride ended early.'}</p>` : '';
    const savedLine = saved === 'account' ? 'Saved to your account.' : saved === 'local' ? 'Saved on this computer. It will be added to your account the next time you open the game online.' : 'Ride too short to save.';
    const notes = `${earnedLine}${workoutLine}${this.ftpResultNote(workout, saved !== false, s.stoppedTheRamp)}${newPbs}<p class="muted small">${savedLine}</p>`;
    const body = `
        <div class="summary-grid">
          <div><small>Time</small><b>${formatDuration(summary.durationSec)}</b></div>
          <div><small>Distance</small><b>${km} km</b></div>
          <div><small>Elevation</small><b>+${Math.round(summary.ascentM)} m</b></div>
          <div><small>Avg power</small><b>${Math.round(summary.avgPower)} W</b></div>
          <div><small>Avg speed</small><b>${summary.avgSpeedKmh.toFixed(1)} km/h</b></div>
          <div><small>Norm. power</small><b>${summary.normalizedPower > 0 ? `${Math.round(summary.normalizedPower)} W` : '--'}</b></div>
          <div><small>Avg HR</small><b>${summary.avgHeartRate ? Math.round(summary.avgHeartRate) : '--'}</b></div>
          <div><small>Coins earned</small><b>${earned}</b></div>
        </div>
        ${notes}`;
    const fit = saved ? '<button class="btn" id="res-fit">Download .fit</button>' : '';
    const done = `<button class="btn ${s.config.career && this.careerNext ? '' : 'primary'}" id="res-done">${this.quickRide ? 'Back to races' : s.config.career ? 'Back to career' : 'Back to menu'}</button>`;
    const next = s.config.career && this.careerNext ? '<button class="btn primary" id="res-next">Next stage</button>' : '';
    const actions = `
        <div class="modal-actions">
          ${saved && workout?.ftpEstimate && workout.ftpKind !== 'twenty' ? `<button class="btn" id="res-ftp">Use ${workout.ftpEstimate} W as FTP</button>` : ''}
          ${fit}
          ${next}
          ${done}
        </div>`;
    const wideResults = hill || !!s.config.career;
    const seasonLine = s.config.career && this.careerSeason ? this.careerSeasonHtml(this.careerSeason) : '';
    this.overlay.innerHTML = wideResults
      ? `<div class="modal glass race-results${raceClasses ? ' has-classes' : ''}"><div class="race-results-bar"><h2>Race results</h2><div class="modal-actions">${fit}${next}${done}</div></div>${raceStats}${seasonLine}<div class="race-results-main">${raceStage}${raceClasses}</div><footer class="race-results-foot">${notes}</footer></div>`
      : `<div class="modal wide glass"><h2>${race ? 'Race results' : train ? 'Workout complete' : 'Ride complete'}</h2>${body}${actions}</div>`;
    this.revealRaceRows();
    if (saved && workout?.ftpEstimate && workout.ftpKind !== 'twenty') {
      const estimate = workout.ftpEstimate;
      this.bindOverlayButton('#res-ftp', () => {
        this.profile.ftp = estimate;
        void this.saveProfile().then(() => toast(`FTP set to ${estimate} W.`, 'success'));
      });
    }
    if (saved) {
      this.bindOverlayButton('#res-fit', () => {
        void this.storage.getRideFit(summary.id).then((fit) => {
          if (fit) downloadBytes(fit, rideFileName(summary));
        });
      });
    }
    this.bindOverlayButton('#res-done', () => this.endSession());
    if (s.config.career && this.careerNext) {
      this.bindOverlayButton('#res-next', () => {
        this.endSession();
        this.startCareerStage();
      });
    }
  }

  /** The season line under the race stats: what this stage did to the ranking and the contract. */
  private careerSeasonHtml(update: SeasonUpdate): string {
    const state = this.career.state;
    const active = state?.active;
    const race = active ? raceById(active.raceId) : this.career.nextEntered();
    let next = '';
    if (active && race) next = `Next: ${race.name}, stage ${active.stageIndex + 1} of ${race.stages.length}`;
    else if (race && state) {
      const day = raceDays(race, state.year)[0];
      next = `Next race: ${race.name}${day ? `, ${formatDate(day.month, day.day)}` : ''}`;
    }
    return seasonUpdateHtml(update, this.career.team()?.division ?? 'continental', next);
  }

  /** Keep the player's row on screen in each results list. */
  private revealRaceRows(): void {
    const settle = () => {
      const seen = new Set<HTMLElement>();
      this.overlay.querySelectorAll('tr.me').forEach((row) => {
        const scroller = scrollingAncestor(row, this.overlay);
        if (!scroller || seen.has(scroller)) return;
        seen.add(scroller);
        const rowBox = row.getBoundingClientRect();
        const box = scroller.getBoundingClientRect();
        if (box.height < 8) return;
        scroller.scrollTop += rowBox.top - box.top - (box.height - rowBox.height) / 2;
      });
    };
    requestAnimationFrame(() => requestAnimationFrame(settle));
    void document.fonts?.ready?.then(() => requestAnimationFrame(settle));
  }

  private updateSound(s: RideSession, dt: number): void {
    const p = s.sim.player;
    const climb = s.config.climb;
    const race = s.config.mode === 'race';
    let crowd = 0;
    let toFinish: number | null = null;
    if (race && climb) {
      toFinish = climb.end - p.s;
      const t = (p.s - climb.start) / Math.max(1, climb.length);
      if (t > 0 && t < 1.02) crowd = Math.min(1, 0.15 + 0.85 * t * t);
      // A big field stretches the crowd over the whole climb, not just the top.
      if (s.config.career) crowd = Math.max(crowd, t > 0 && t < 1 ? 0.35 : 0);
    }
    sound.updateRide({ speed: p.v, power: s.power3s, grade: 0, crowd, toFinish, paused: s.state !== 'riding' }, dt);
    if (race && toFinish !== null) sound.setMusic(toFinish < 1000 ? 'finale' : crowd > 0.2 ? 'climb' : 'ride');
    if (race && p.finishTime != null && !this.finishSting) {
      this.finishSting = true;
      sound.play('kom');
    }
  }

  private finishSting = false;

  private syncCareerRide(s: RideSession): void {
    // A one-off pro race has no team of your own, so no team orders.
    const road = s.config.career && !s.config.career.road.timeTrial && !this.quickRide;
    this.hud.setOrders(!!road, s.sim.paceOn, s.sim.paceWkg, s.sim.waitOn);
    if (!s.config.career) return;
    for (const text of s.sim.drainEvents()) toast(text, 'info', 4200);
  }

  private onTeamOrder(kind: 'pace' | 'wait' | 'wkg', value?: number): void {
    const sim = this.session?.sim;
    if (!sim || !this.session?.config.career) return;
    sim.manual = true;
    if (kind === 'wkg' && value != null) {
      sim.paceWkg = value;
      sim.paceOn = true;
      return;
    }
    if (kind === 'pace') {
      sim.paceOn = !sim.paceOn;
      const left = sim.racers.some((r) => r.road?.teammate && r.finishTime == null);
      if (sim.paceOn && !left) toast('No teammates left in the race.', 'info');
      return;
    }
    sim.waitOn = !sim.waitOn;
    const ahead = sim.racers.some((r) => r.road?.teammate && r.finishTime == null && r.s > sim.player.s + 15);
    if (sim.waitOn && !ahead) toast('No teammate is up the road.', 'info');
  }

  private careerRows(s: RideSession): StageResultRow[] {
    const teamId = this.career.state?.teamId ?? '';
    const age = this.career.state?.age ?? 24;
    return s.sim.standings().flatMap((r) => {
        const time = r.officialTime || r.finishTime;
      if (time == null) return [];
      return [{
        riderId: r.isPlayer ? 'player' : r.road?.riderId ?? r.name,
        name: r.isPlayer ? (this.profile.name || 'You') : r.name,
        teamId: r.isPlayer ? teamId : r.road?.teamId ?? '',
        country: r.isPlayer ? (this.career.state?.nation ?? '') : r.country,
        age: r.isPlayer ? age : r.road?.age ?? 28,
        time,
        sprint: r.sprintPts,
        kom: r.komPts,
        isPlayer: r.isPlayer,
      }];
    });
  }

  private startCareerStage(): void {
    const launch = this.career.launch({
      name: this.profile.name || 'You',
      weightKg: this.profile.weightKg,
      skin: this.profile.colors.skin,
      bike: this.profile.colors,
    });
    if (!launch) {
      toast('That stage is not ready.', 'error');
      return;
    }
    this.pendingLaunch = launch;
    void this.startRide('race');
  }

  private paintCareerStages(): void {
    if (this.screen !== 'career') return;
    this.panel.querySelectorAll<HTMLCanvasElement>('canvas.stage-profile').forEach((canvas) => {
      const [raceId, indexRaw] = (canvas.dataset.stage ?? '').split(':');
      const race = raceById(raceId);
      const stage = race?.stages[Number(indexRaw)];
      if (!race || !stage) return;
      const span = stageWindow(stage);
      drawClimbCard(canvas, getRoute(getRouteDef(span.routeId)), span.start, span.end, 12, FREE_RIDE_RISE, stagePrimes(stage, race.stages.length === 1), undefined, span.reverse);
    });
  }

  private bindCareer(): void {
    requestAnimationFrame(() => this.paintCareerStages());
    const read = (key: string) => Number(this.panel.querySelector<HTMLInputElement>(`[data-career="${key}"]`)?.value);
    const riderSearch = this.panel.querySelector<HTMLInputElement>('[data-career="rider-search"]');
    riderSearch?.addEventListener('input', () => {
      const query = riderSearch.value.trim().toLocaleLowerCase('en-US');
      this.panel.querySelectorAll<HTMLElement>('[data-rider]').forEach((row) => {
        row.hidden = query.length > 0 && !(row.dataset.rider ?? '').includes(query);
      });
    });
    // A Ride tick sits in the race summary. Keep that click on the checkbox.
    this.panel.querySelectorAll('summary label.check').forEach((label) => {
      label.addEventListener('click', (event) => event.stopPropagation());
    });
    this.panel.querySelectorAll('details.race-detail').forEach((fold) => {
      fold.addEventListener('toggle', () => {
        if ((fold as HTMLDetailsElement).open) requestAnimationFrame(() => this.paintCareerStages());
      });
    });
    this.panel.querySelectorAll<HTMLInputElement>('[data-career^="draft-"], [data-career^="diff-"]').forEach((input) => {
      input.addEventListener('input', () => {
        const label = this.panel.querySelector(`[data-for="${input.dataset.career}"]`);
        if (label) label.textContent = Number(input.value).toFixed(1);
      });
    });
    if (this.careerListening) return;
    this.careerListening = true;
    const tip = document.createElement('div');
    tip.id = 'prime-tip';
    tip.hidden = true;
    this.ui.appendChild(tip);
    const hideTip = () => {
      tip.hidden = true;
    };
    this.panel.addEventListener('pointermove', (event) => {
      const canvas = event.target instanceof HTMLCanvasElement && event.target.classList.contains('stage-profile') ? event.target : null;
      if (!canvas) {
        hideTip();
        return;
      }
      const rect = canvas.getBoundingClientRect();
      const hit = primeUnder(canvas, event.clientX - rect.left, event.clientY - rect.top);
      canvas.style.cursor = hit ? 'pointer' : '';
      if (!hit) {
        hideTip();
        return;
      }
      tip.innerHTML = `<b>${esc(hit.name)}</b><span>${hit.points.join(', ')} pts</span>`;
      tip.hidden = false;
      const width = tip.offsetWidth;
      const height = tip.offsetHeight;
      const roomLeft = event.clientX - width - 12;
      const left = roomLeft >= 8 ? roomLeft : Math.min(event.clientX + 14, window.innerWidth - width - 8);
      const above = event.clientY - height - 10;
      tip.style.left = `${Math.max(8, left)}px`;
      tip.style.top = `${above > 8 ? above : Math.min(event.clientY + 14, window.innerHeight - height - 8)}px`;
    });
    this.panel.addEventListener('pointerleave', hideTip);
    this.panel.addEventListener('change', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;
      if (target.dataset.career === 'enter' && target.dataset.race) {
        const note = this.career.setEnter(target.dataset.race, target.checked);
        if (note) toast(note, 'info', 4600);
        const chosen = new Set(this.career.state?.entered ?? []);
        this.panel.querySelectorAll<HTMLInputElement>('[data-career="enter"]').forEach((box) => {
          if (box.dataset.race) box.checked = chosen.has(box.dataset.race);
        });
        // Ticked, unticked and next on the month grid, without re-rendering (which would close the open race).
        this.panel.querySelectorAll<HTMLElement>('.race-chip[data-race]').forEach((chip) => {
          const name = calendarChipClass(chip.dataset.race!, this.career);
          if (name) chip.className = name;
        });
      }
      if (target.dataset.career === 'cal-mine') {
        this.career.calendarMine = target.checked;
        this.render();
      }
      if (target.dataset.career === 'nation') this.career.draftNation = target.value;
      if (target.dataset.career === 'tactic' && target.dataset.tactic) {
        this.career.setTactic(target.dataset.tactic as 'sprint' | 'climb' | 'control');
      }
      if (target.dataset.career === 'squad' && target.dataset.rider) {
        const note = this.career.toggleSquad(target.dataset.rider);
        if (note) toast(note, 'info');
        this.render();
      }
      if (target.dataset.career === 'diff-tt') {
        this.career.setTimeTrial(read('diff-tt') || 4.6);
      } else if (target.dataset.career?.startsWith('diff-')) {
        this.career.setDifficulty(read('diff-flat') || 3.4, read('diff-hill') || 3.8, read('diff-mountain') || 4.3);
      }
    });
    this.panel.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLElement>('[data-career]');
      if (!button || button instanceof HTMLInputElement) return;
      const act = button.dataset.career;
      if (act === 'tab' && button.dataset.tab) {
        if (button.dataset.tab === 'riders') this.career.browseTeam = null;
        this.career.tab = button.dataset.tab as typeof this.career.tab;
        this.render();
      } else if (act === 'browse') {
        this.career.browseTeam = button.dataset.team || null;
        this.render();
      } else if (act === 'sort' && button.dataset.key) {
        const key = button.dataset.key;
        if (this.career.riderSort.key === key) this.career.riderSort.dir = this.career.riderSort.dir === 1 ? -1 : 1;
        else this.career.riderSort = { key, dir: key === 'name' || key === 'country' || key === 'team' || key === 'division' ? 1 : -1 };
        this.render();
      } else if (act === 'draft-team' && button.dataset.team) {
        this.career.draftTeam = button.dataset.team;
        this.render();
      } else if (act === 'create') {
        this.career.create(this.career.draftTeam, this.career.draftNation, read('draft-flat') || 3.4, read('draft-hill') || 3.8, read('draft-mountain') || 4.3);
        this.render();
      } else if (act === 'brief') {
        this.career.openBrief();
        this.career.tab = 'brief';
        this.render();
      } else if (act === 'advance') {
        const notes = this.career.simulateAhead();
        toast(notes.length ? notes.slice(0, 3).join(' · ') : 'Nothing to simulate.', 'info', 5000);
        this.render();
      } else if (act === 'rank' && (button.dataset.sheet === 'rankings' || button.dataset.sheet === 'results')) {
        this.career.rankSheet = button.dataset.sheet;
        this.render();
      } else if (act === 'rank-table' && button.dataset.table) {
        this.career.rankTable = button.dataset.table as NonNullable<typeof this.career.rankTable>;
        this.render();
      } else if (act === 'skip') {
        this.career.skipNext();
        toast('Race skipped. No points.', 'info');
        this.render();
      } else if (act === 'start') {
        const active = this.career.state?.active;
        const race = active ? raceById(active.raceId) : undefined;
        const need = race ? startMateCount(race) : 0;
        if (active && active.stageIndex === 0 && active.squad && active.squad.length !== need) {
          toast(`Choose ${need} teammates before the start.`, 'info');
          return;
        }
        this.startCareerStage();
      } else if (act === 'sign' && button.dataset.team) {
        this.career.acceptOffer(button.dataset.team);
        this.render();
      } else if (act === 'download') {
        const raw = localStorage.getItem('cyclebuddy-career') ?? '';
        const blob = new Blob([raw], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `cyclebuddy-career-${this.career.state?.year ?? 'save'}.json`;
        link.click();
        URL.revokeObjectURL(url);
      } else if (act === 'month') {
        this.career.shiftCalendar(Number(button.dataset.dir) || 0);
        this.render();
      } else if (act === 'reset') {
        if (confirm('Delete this career and start again?')) {
          this.career.reset();
          this.render();
        }
      }
    });
  }

  private endSession() {
    this.session = null;
    sound.stopRide();
    sound.setMusic('menu');
    this.resetLook();
    this.overlay.innerHTML = '';
    this.syncOverlayPointer();
    this.hud.show(false);
    this.ui.classList.remove('riding');
    void this.wakeLock?.release();
    this.wakeLock = null;
    this.finishing = false;
    this.devices.releaseToFlat();
    this.world?.setTrafficEnabled(true);
    this.world?.setRaceClimb(null);
    this.world?.setPrimeArches([]);
    this.world?.setRiderColors([this.profile.colors]);
    const back = this.afterRide;
    this.afterRide = 'home';
    this.go(back);
  }

  private onLookDown(e: PointerEvent): void {
    if (e.button !== 0 || !this.session || !this.world || this.uiBlocksLook()) return;
    if (e.target !== this.canvas) return;
    this.draggingLook = true;
    this.lookPointer = e.pointerId;
    this.dragX = e.clientX;
    this.dragY = e.clientY;
    this.dragYaw = this.lookYaw;
    this.dragPitch = this.lookPitch;
  }

  private onLookMove(e: MouseEvent): void {
    if (!this.draggingLook || !this.session || !this.world) return;
    const locked = document.pointerLockElement === this.canvas;
    const dx = (locked ? e.movementX : e.clientX - this.dragX) / window.innerWidth;
    const dy = (locked ? e.movementY : e.clientY - this.dragY) / window.innerHeight;
    const tau = Math.PI * 2;
    const yaw = locked ? this.lookYaw + dx * 2.4 : this.dragYaw + dx * 2.4;
    const pitch = locked ? this.lookPitch - dy * 1.4 : this.dragPitch - dy * 1.4;
    this.lookYaw = ((yaw + Math.PI) % tau + tau) % tau - Math.PI;
    this.lookPitch = Math.max(-0.42, Math.min(0.48, pitch));
    this.world.setMouseLook(this.lookYaw, this.lookPitch);
  }

  /** Hold L to look behind. The turn is eased in the world; the mouse look stays as it was and comes back on release. */
  private setLookBack(on: boolean): void {
    if (this.lookBack === on) return;
    this.lookBack = on;
    this.world?.setLookBack(on);
    this.hud.setLookBack(on);
  }

  private resetLook(): void {
    this.lookYaw = 0;
    this.lookPitch = 0;
    this.lookBack = false;
    this.hud.setLookBack(false);
    this.releaseLook();
    this.world?.setLookBack(false);
    this.world?.setMouseLook(0, 0);
  }

  /** Drop the captured cursor so overlay buttons receive the click. */
  private releaseLook(): void {
    this.draggingLook = false;
    if (this.lookPointer >= 0 && this.canvas.hasPointerCapture(this.lookPointer)) {
      this.canvas.releasePointerCapture(this.lookPointer);
    }
    this.lookPointer = -1;
    if (document.pointerLockElement) document.exitPointerLock();
    this.canvas.classList.add('ui-open');
    // The class was set here, outside syncOverlayPointer: let the next frame write the state again.
    this.overlayOpen = null;
  }

  private onHover(e: PointerEvent): void {
    if (e.pointerType === 'touch' || e.target !== this.canvas) {
      this.hoverAt = null;
      return;
    }
    const rect = this.canvasRect();
    this.hoverAt = { x: e.clientX - rect.left, y: e.clientY - rect.top, left: rect.left, top: rect.top };
  }

  /** W/kg over the AI rider under the mouse. What else it shows depends on the kind of ride. */
  private updateRiderTag(s: RideSession, poses: RiderPose[], world: World): void {
    const at = this.hoverAt;
    if (!at || this.draggingLook || this.uiBlocksLook() || s.state === 'countdown') {
      this.riderTag.hide();
      return;
    }
    const racers = s.sim.racers;
    const box = this.canvasRect();
    const pick = pickRider(poses, world.camera, box.width, box.height, at.x, at.y, (i) => !racers[i] || racers[i].isPlayer);
    if (!pick) {
      this.riderTag.hide();
      return;
    }
    const r = racers[pick.index];
    const mode: TagMode = s.config.mode === 'free' ? 'free' : s.config.mode === 'train' ? 'train' : s.config.career ? 'career' : 'hillclimb';
    const lines = tagLines(mode, { name: r.name, gcRank: r.road?.gcRank, gcGap: r.road?.gcGap }, s.wkgOf(pick.index));
    this.riderTag.show(lines, pick.x + at.left, pick.y + at.top);
  }

  /**
   * The 3D canvas's box, read once and kept until it is resized.
   * Perf: the hover tag used to read layout on every pointer move and every frame (clientWidth after
   * the HUD's writes forces a layout). The canvas is fixed to the viewport, so only a resize moves it.
   */
  private canvasRect(): { left: number; top: number; width: number; height: number } {
    if (!this.canvasBox) {
      const r = this.canvas.getBoundingClientRect();
      // clientWidth/Height, as pickRider was given before: the box inside any border.
      this.canvasBox = { left: r.left, top: r.top, width: this.canvas.clientWidth, height: this.canvas.clientHeight };
    }
    return this.canvasBox;
  }

  private uiBlocksLook(): boolean {
    // Runs every frame: check the state first, and the overlay's children instead of serializing its HTML.
    return this.session?.state === 'paused' || this.session?.state === 'finished' || this.overlay.firstChild !== null;
  }

  // ---------------------------------------------------------------- keyboard

  private onKey(e: KeyboardEvent) {
    sound.unlock();
    if (this.loading) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    const s = this.session;
    const key = e.key.toLowerCase();
    const menuKey = !s && this.screen === 'home' && !this.overlay.innerHTML ? HOME_KEYS.find((m) => m.key === key) : undefined;
    if (menuKey) {
      this.go(menuKey.go as Screen);
      return;
    }
    if (key === 'escape') {
      this.releaseLook();
      if (!s) {
        if (this.screen !== 'home' && !this.overlay.innerHTML) this.go('home');
        return;
      }
      if (s.state === 'finished') return;
      if (s.state === 'paused') this.resume();
      else this.showPause();
    } else if (key === 'c' && s && this.world) {
      this.cycleCamera();
    } else if (key === 'h' && s) {
      this.hud.toggle();
    } else if (key === 'm' && s) {
      this.cycleMap();
    } else if (key === 't' && this.world) {
      this.cycleTime();
    } else if (key === 'l' && s && this.world && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (!this.uiBlocksLook()) this.setLookBack(true);
    } else if (key === 'b') {
      this.brakeKey = true;
      this.applyBrake();
    } else if (key === 'r' && s) {
      s.turnAround();
    } else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && s?.config.mode === 'train' && s.erg && !s.inOpenEffort && s.state !== 'finished') {
      e.preventDefault();
      s.nudgeErg((e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 0.05 : 0.01));
      toast(`ERG ${Math.round(s.ergBias * 100)}%`, 'info', 800);
    } else if (key === 'e' && s?.inOpenEffort) {
      toast('These 20 minutes are your own power. The road sets the resistance.', 'info', 1600);
    } else if (key === 'e' && s?.config.mode === 'train' && s.state !== 'finished') {
      s.erg = !s.erg;
      if (!s.erg) this.devices.setErgWatts(null);
      toast(s.erg ? 'ERG on. The trainer holds the target.' : 'Slope mode. The road sets the resistance.', 'info', 1600);
    } else if ((key === '[' || key === ']') && s) {
      const d = Math.max(0, Math.min(100, s.config.profile.difficulty + (key === ']' ? 10 : -10)));
      s.config.profile.difficulty = d;
      this.profile.difficulty = d;
      toast(`Trainer difficulty ${d}%`, 'info', 1500);
      void this.saveProfile();
    }
  }
}

function scrollingAncestor(node: Element, stop: Element): HTMLElement | null {
  let parent = node.parentElement;
  while (parent && parent !== stop) {
    const overflow = getComputedStyle(parent).overflowY;
    if (overflow === 'auto' || overflow === 'scroll') return parent;
    parent = parent.parentElement;
  }
  return null;
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}
