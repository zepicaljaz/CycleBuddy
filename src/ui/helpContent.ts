export interface HelpSection {
  id: string;
  title: string;
  html: string;
}

export const HELP_SECTIONS: HelpSection[] = [
  {
    id: 'connect',
    title: 'Connect a smart trainer',
    html: `
<p class="lead">CycleBuddy talks to your trainer directly over Bluetooth from the browser. No extra apps, no subscription. Any smart trainer that uses the standard Bluetooth fitness protocol (FTMS) can connect: Wahoo, Elite, Saris, Garmin, Tacx and others.</p>
<h3>What you need</h3>
<ul>
  <li><b>Google Chrome</b> or <b>Microsoft Edge</b> on a Mac or Windows computer with Bluetooth. (Safari, Firefox and iPhone/iPad do not support Web Bluetooth.)</li>
  <li>A smart trainer plugged into power. It must support <b>FTMS</b> (the standard Bluetooth trainer protocol) so CycleBuddy can set the gradient. Older Tacx trainers that only speak Tacx FE-C over Bluetooth still connect.</li>
  <li>Trainers that only use ANT+ cannot connect from a browser. Update the trainer firmware in its own app if FTMS is offered as an option.</li>
  <li>Optional: a Bluetooth heart-rate strap (Garmin, Wahoo, Polar and similar).</li>
</ul>

<h3>One-time preparation</h3>
<ol>
  <li><b>Update the trainer firmware</b> with the app from the trainer's maker, and turn on FTMS if the app has that setting. Older Tacx firmware still works through Tacx FE-C over Bluetooth.</li>
  <li><b>Calibrate (spin-down)</b> in that same app every few weeks for accurate power.</li>
  <li><b>Mac only:</b> open <i>System Settings &rarr; Privacy &amp; Security &rarr; Bluetooth</i> and allow <b>Google Chrome</b> (or Edge). Restart the browser after changing this.</li>
  <li><b>Windows only:</b> make sure Bluetooth is turned on in <i>Settings &rarr; Bluetooth &amp; devices</i>. You do <u>not</u> need to pair the trainer in Windows settings.</li>
</ol>

<h3>Connecting before each ride</h3>
<ol>
  <li><b>Close other apps</b> that might be connected to the trainer: Zwift, Rouvy, the trainer's phone app, a bike computer. A trainer accepts only one controlling app at a time.</li>
  <li><b>Wake the trainer</b> by turning the pedals a few times.</li>
  <li>In CycleBuddy, click <b>Pair</b> next to Trainer in the top bar.</li>
  <li>A browser window opens with nearby smart trainers. Select yours (for example <b>KICKR</b>, <b>DIRETO</b> or <b>Tacx Flux</b>) and click <b>Pair</b>.</li>
  <li>Within a few seconds the top bar shows <b>Trainer: connected</b> and the protocol (FTMS, or FE-C for an older Tacx). Start pedalling: you should see your power and cadence.</li>
  <li>Optional: click <b>Pair</b> next to Heart rate and select your heart-rate strap (wet the strap contacts first).</li>
</ol>

<h3>How resistance works</h3>
<p>CycleBuddy runs in <b>SIM mode</b>: it sends the road gradient to the trainer, which makes it harder on climbs and easier on descents, just like riding outside. Shift gears to keep a comfortable cadence.</p>
<ul>
  <li><b>Trainer difficulty</b> (Settings) controls how much of the real gradient you feel. At 50% an 8% climb feels like 4%. Your speed in the game always uses the <i>real</i> gradient, so difficulty only changes the feel, not your results.</li>
  <li>Most trainers simulate climbs up to about 16%. A trainer without a motor cannot push the pedals, so on descents it eases off to its lightest resistance.</li>
</ul>

<h3>No trainer handy?</h3>
<p>Click <b>Virtual</b> next to Trainer in the top bar to try the game with the keyboard: <kbd>&uarr;</kbd>/<kbd>&darr;</kbd> change power by 10 W (hold <kbd>Shift</kbd> for 50 W).</p>
`,
  },
  {
    id: 'play',
    title: 'How to play',
    html: `
<h3>First things first: your profile</h3>
<p>Enter your <b>weight</b> and <b>FTP</b> (Functional Threshold Power: the power you can hold for about an hour) in Settings. Weight is used for climbing physics; FTP is used for time estimates and to place you among the AI riders. Not sure about FTP? Use 2.5&ndash;3.0 W/kg &times; your weight as a start. Both are saved with your account, so signing in on another computer uses the same kilograms and FTP.</p>

<h3>Free Ride</h3>
<ul>
  <li>Pick a landscape, then a loop. You can ride as many laps as you like. <b>Real climbs</b> are the published climbs on their real roads: up, around the loop at the top, and back down the same way.</li>
  <li>The roads are busy. Some riders go easy, down to about 1 W/kg, and some ride harder, up to about 5 W/kg. A group rides two side by side, with more rows behind when there are more of them. Some come towards you on the left side of the road.</li>
  <li>You can ride with a buddy. They hold the power you set for the flat, for hills of 2–5%, and for climbs steeper than 5%. They do not match your speed. At the bottom and the top of each climb they wait or catch you, so you are together there. You stay in their lane instead of pulling out to the left.</li>
  <li>The road passes through small towns. Cars keep the right lane, move left to pass a slower car or rider, then move back. If cyclists are already passing each other, the car waits until they close up, then goes by. Cars coming the other way do the same on their side of the road.</li>
  <li>Climbs are inspired by famous real climbs (Alpe d'Huez, Mont Ventoux, Stelvio, Sa Calobra, Jebel Hafeet, Bealach na Bà), on roads of their own. A green arch marks the start of each climb and a red arch marks the summit. Your best times on every climb are saved automatically.</li>
  <li>Press <kbd>Esc</kbd> to pause or finish. Finished rides are saved and can be exported as .FIT for Strava or Garmin Connect.</li>
</ul>

<h3>Training plans</h3>
<ul>
  <li>Open <b>Training Plans</b>, pick a plan, and select a workout. The highlighted workout is the one you will ride. Continue to route selection, then choose a landscape and a loop. A flat road keeps your speed steady. The list covers new riders, FTP and sweet spot, climbers, time trialists, puncheurs, sprinters, all-rounders, masters, gran fondos, a race peak, triathlon, gravel, base miles, and an in-season week you can repeat.</li>
  <li>The <b>FTP test</b> is the first option. Warm up, then ride 20 minutes as hard as you can hold. Your FTP becomes 95% of that average and replaces the number from sign-in or Settings. Every finished test is saved on that screen, newest first, with the change from the test before it.</li>
  <li>Other targets are a percent of that FTP. A ramp test is included in Back to Fitness, FTP Builder and Build Me Up. The estimate is 75% of the last minute you complete. You can save that number as your FTP at the end. Those ramp results are kept with the 20-minute tests.</li>
  <li><b>ERG</b> is on when a workout starts: the trainer holds the watts, and you choose the cadence. <kbd>&uarr;</kbd>/<kbd>&darr;</kbd> nudge the target by 1% (Shift: 5%). Press <kbd>E</kbd> and the road sets the resistance instead. The workout pauses while the ride is paused.</li>
  <li>Finish the workout, or end it from the pause menu. Riding at least 80% of it ticks that workout off. The tick is saved with the ride.</li>
</ul>

<h3>Hill-Climb Race</h3>
<ul>
  <li>At the top of the screen, choose how many AI riders (50&ndash;100) and how hard they ride. They are the best climbers from Career, with a single initial, like T. Novarik. He holds the strongest W/kg. The others sit just under that and spread down to the slowest, so the gaps open near the summit. A field of 75 leaves out the weaker climbers. Each rider holds that effort for the whole climb, with a small sprint in the last 100 m. Riders with a similar rating can change places.</li>
  <li>The list opens with the longest climbs first. Sort by length, average grade, elevation or route, or pick one loop. Click the active sort again to reverse it. Search finds a climb or a loop by name. Each card names its loop. The profiles share one scale, so a short climb stays narrow and a small one stays low.</li>
  <li>A gold circle on the road marks your bike, so you can find yourself in the field.</li>
  <li>The race starts after a 10-second countdown, so you have time to clip in and start pedalling. Spectators line the whole climb, with a bigger crowd at the bottom and at the summit. The last part is fenced, with a finish line and an arch at the top. A small red flag over the road marks one kilometre to go.</li>
</ul>

<h3>Drafting</h3>
<p>Riding close behind another rider saves up to 30-40% of your air resistance. A rider still shelters you when they are a little to one side, which is how a pair rides. When you are faster you move left to pass, then return to the right. If the riders ahead already fill that side, a faster rider overlaps through them instead of sitting on the wheel. Other riders pass you on the left as well. Drafting matters a lot on the flat and much less on steep climbs. The HUD shows a <b>DRAFT</b> indicator when you are sheltered.</p>

<h3>Reading the HUD</h3>
<ul>
  <li><b>Top left:</b> power (3-second average), W/kg, cadence, heart rate, speed.</li>
  <li><b>Under those stats:</b> camera, time of day, map, turn around, look back and brake. Click a row, or press <kbd>C</kbd>, <kbd>T</kbd> or <kbd>M</kbd>. CycleBuddy keeps the last choice for the next ride. <kbd>R</kbd> turns the bike around when you are stopped, on a free ride or a training plan. It stays faded while you are moving, and a race has no turn-around. The lap bar, the next climb, the elevation profile and the map follow the new direction. Hold the Look back row, or hold <kbd>L</kbd>, to look behind you. Hold the Brake row, or hold <kbd>B</kbd>, and speed falls gradually to a stop, including on a steep descent.</li>
  <li><b>Map:</b> the nearby road, fixed to the world and always the same size, coloured by gradient (blue downhill, green flat, yellow to purple uphill). Press <kbd>M</kbd> and it zooms out to a wider stretch, about five times further. Press <kbd>M</kbd> again and it zooms out to the whole loop, where climbs are marked in gold. Press <kbd>M</kbd> once more and it zooms back in. In a race the other riders are marked on the map. A free ride shows only you.</li>
  <li><b>Top centre:</b> current climb, then time, distance, elevation already climbed, average power and average speed. On a free ride the bar moves forward as you ride, and after a turn the next climb is the one ahead of you.</li>
  <li><b>Top right:</b> race standings around you with time gaps. The leader stays on the top row and last place on the bottom row. A free ride shows lap and ride stats instead.</li>
  <li><b>Bottom:</b> elevation profile, coloured by steepness (green easy &rarr; red/purple very steep).</li>
  <li><b>Segments:</b> every named climb records a time, like a Strava segment. On a free ride you can start at kilometre 0, or at the bottom or the top of a climb. Compare attempts under <b>Analytics → Segment analyzer</b>. A career stage keeps each named climb you ride all the way through.</li>
</ul>

<h3>Garage</h3>
<p>Customise the colours of your jersey, shorts, helmet, bike frame, wheels and shoes. Your look is saved in your profile.</p>
<p>Every full kilometre earns 1 Coin. Coins are spent in Equipment, and a frame is bought separately from its wheels. The balance is shown there. Coins, the bikes you have bought, and the kit you have equipped are saved with your account, so they are there when you sign in on another computer.</p>
`,
  },
  {
    id: 'keys',
    title: 'Keyboard shortcuts',
    html: `
<table class="keys">
  <tr><td><kbd>Esc</kbd></td><td>Pause menu (resume / finish / discard)</td></tr>
  <tr><td><kbd>C</kbd></td><td>Change camera (chase / close / aerial / helicopter / first person) and recentre the view</td></tr>
  <tr><td>Mouse</td><td>Hold the left button and drag to look around. Chase, close and aerial cameras orbit the rider through a full circle, so the cyclist stays in view. The helicopter flies itself and does not follow the mouse. The view stays there until you press <kbd>C</kbd>.</td></tr>
  <tr><td><kbd>L</kbd></td><td>Hold to look behind you. Let go and the view returns to where it was. Works with the chase, close, aerial and first person cameras, and together with the mouse.</td></tr>
  <tr><td><kbd>H</kbd></td><td>Hide / show the HUD</td></tr>
  <tr><td><kbd>M</kbd></td><td>Switch the map: nearby road, wider road, then the full loop</td></tr>
  <tr><td><kbd>T</kbd></td><td>Cycle time of day</td></tr>
  <tr><td><kbd>B</kbd></td><td>Hold to brake, or hold the Brake row under the ride stats. Speed falls gradually to a stop, so a descent does not keep you rolling.</td></tr>
  <tr><td><kbd>R</kbd></td><td>Free ride or training plan, when stopped: turn around and ride the other way. The lap bar, the next climb, the elevation profile and the map follow the new direction.</td></tr>
  <tr><td><kbd>&uarr;</kbd> / <kbd>&darr;</kbd></td><td>Virtual trainer: +/- 10 W (Shift: 50 W). During a training plan with ERG on: nudge the target by 1% (Shift: 5%).</td></tr>
  <tr><td><kbd>E</kbd></td><td>Training plan: switch between ERG and the road setting the resistance</td></tr>
  <tr><td><kbd>[</kbd> / <kbd>]</kbd></td><td>Trainer difficulty -/+ 10%</td></tr>
</table>
`,
  },
  {
    id: 'trouble',
    title: 'Troubleshooting',
    html: `
<h3>The trainer does not appear in the list</h3>
<ul>
  <li>Make sure the trainer is plugged in and pedal to wake it.</li>
  <li>Close Zwift, Rouvy, the trainer's phone app and any bike computer that may be connected to it, then wait 10 seconds.</li>
  <li>The trainer must advertise Bluetooth FTMS, or be an older Tacx using FE-C. An ANT+-only trainer will not appear.</li>
  <li>On a Mac, check that Chrome/Edge is allowed in <i>System Settings &rarr; Privacy &amp; Security &rarr; Bluetooth</i>.</li>
  <li>Move the computer closer to the trainer (within ~3 m works best).</li>
</ul>
<h3>"GATT operation failed" or it fails right after you pick the trainer</h3>
<ul>
  <li>Another app still owns the trainer. Quit Zwift, Rouvy and the trainer's phone app completely, wait 10 seconds, then try again.</li>
  <li>Turn the trainer off at the wall socket, wait 10 seconds, plug it back in and pedal once to wake it.</li>
  <li>Click <b>Pair</b> next to Trainer again. CycleBuddy retries the Bluetooth handshake on its own.</li>
</ul>
<h3>"Web Bluetooth is not available"</h3>
<p>Use Chrome or Edge on desktop. The page must be opened from <code>http://localhost</code> or an <code>https://</code> address.</p>
<h3>Power is shown but resistance doesn't change</h3>
<ul>
  <li>Another app may have taken control of the trainer. Close it and reconnect.</li>
  <li>Check that trainer difficulty in Settings is above 0%.</li>
  <li>Update the trainer firmware with its own app, and enable FTMS if that is a separate option.</li>
</ul>
<h3>Connection drops during a ride</h3>
<p>CycleBuddy automatically tries to reconnect for about a minute. Your ride keeps recording. If it fails, click <b>Pair</b> next to Trainer again. Wi-Fi routers and USB 3 hubs near the computer can disturb Bluetooth.</p>
<h3>The game is slow or stutters</h3>
<p>Lower <b>Graphics quality</b> in Settings (Medium is a good choice for laptops). Plug your laptop into power, and close other heavy browser tabs.</p>
<h3>Where are my rides stored?</h3>
<p>On your account. Sign in on another browser and the same rides are there. A copy also stays in the browser you rode on, so a finished ride is still on this computer if the connection drops. Use <b>Analytics &rarr; All rides &rarr; Export backup</b> when you want a file, and upload important rides to Strava or Garmin as .FIT files.</p>
`,
  },
];
