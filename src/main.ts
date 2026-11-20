import './styles.css';
import { showPlayBoot } from './game/playBoot';

const play = location.pathname === '/play' || location.pathname.startsWith('/play/');
const training = location.pathname === '/training-plans' || location.pathname.startsWith('/training-plans/');

if (play) showPlayBoot();

if (play) {
  const { startGame } = await import('./game/boot');
  await startGame();
} else {
  const { startSite } = await import('./site/home');
  await startSite(training ? 'training' : 'home');
}
