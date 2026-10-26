import './controls.css';

/** 键帽：等宽字，底边 3px。组合键用「+」分开，每一段一个键帽。 */
export function Keycap({ keys, small }: { keys: string; small?: boolean }) {
  return <>{keys.split('+').map((k, i) => <kbd key={i} className={`kc${small ? ' sm' : ''}`}>{k}</kbd>)}</>;
}
