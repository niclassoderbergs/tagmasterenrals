import React, { useEffect, useRef, useState } from 'react';
import { TrainCar } from '../types';

// --- TYPES ---
type WagonType = 'BOX' | 'BOUNCY' | 'HEAVY' | 'TANK';

interface GameWagon {
  id: string;
  type: WagonType;
  cargoHealth: number; // 0-100%
  cargoOffset: { x: number, y: number }; // Visual physics offset
}

interface ScoreResult {
  total: number;
  wagonPoints: number; // Modighetsbonus
  cargoPoints: number; // Lastbonus
  speedPoints: number; // Snabbhetsbonus
  wagonsCount: number;
  healthPercent: number; // 0-1
  stars: number;
}

interface TrainDeliveryGameProps {
  cars: TrainCar[];
  onComplete: () => void;
}

// --- CONFIG ---
const WAGON_CONFIG: Record<WagonType, { 
  name: string; 
  color: string; 
  icon: string; 
  desc: string;
  effect: string;
  weight: number;
}> = {
  'BOX': { 
    name: 'LÅDVAGN', 
    color: '#15803d', // Green
    icon: '📦', 
    desc: 'Stabil och trygg.',
    effect: 'Säkra poäng',
    weight: 1.0
  },
  'BOUNCY': { 
    name: 'STUDSVAGN', 
    color: '#be185d', // Pink
    icon: '🎈', 
    desc: 'Lasten studsar!',
    effect: 'Kör mjukt!',
    weight: 0.8
  },
  'HEAVY': { 
    name: 'TUNG VAGN', 
    color: '#713f12', // Brown
    icon: '🪵', 
    desc: 'Tung i backarna.',
    effect: 'Bromsar tåget',
    weight: 2.5
  },
  'TANK': { 
    name: 'TANKVAGN', 
    color: '#1d4ed8', // Blue
    icon: '🛢️', 
    desc: 'Vätska skvimpar.',
    effect: 'Skvalpar lätt',
    weight: 1.2
  }
};

export const TrainDeliveryGame: React.FC<TrainDeliveryGameProps> = ({ cars, onComplete }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // Determine capacity based on collected cars (excluding locomotive)
  // Ensure at least 1 slot if something goes weird, though app logic prevents it.
  const maxSlots = Math.max(1, cars.filter(c => c.type !== 'LOCOMOTIVE').length);

  // STATE
  const [phase, setPhase] = useState<'BUILD' | 'MISSION_INTRO' | 'DRIVE' | 'SUMMARY'>('BUILD');
  const [selectedWagons, setSelectedWagons] = useState<WagonType[]>([]);
  const [missionText, setMissionText] = useState("");
  
  // GAME STATS
  const [startTime, setStartTime] = useState(0);
  const [scoreResult, setScoreResult] = useState<ScoreResult | null>(null);
  
  // HUD STATS
  const [speedDisplay, setSpeedDisplay] = useState(0);
  const [progressDisplay, setProgressDisplay] = useState(0);
  const [cargoStatus, setCargoStatus] = useState<number[]>([]); 
  const [showStartHint, setShowStartHint] = useState(false);
  
  // PHYSICS ENGINE STATE
  const engine = useRef({
    active: false,
    distance: 0,
    totalDistance: 5000,
    speed: 0,
    throttle: 0, // 0-1
    wagons: [] as GameWagon[],
    particles: [] as {x: number, y: number, vx: number, vy: number, life: number, color: string, size: number}[],
    trainMass: 1,
    lastTime: 0,
    snowOffset: 0
  });

  // --- BUILD PHASE LOGIC ---

  const addWagon = (type: WagonType) => {
    if (selectedWagons.length < maxSlots) {
      setSelectedWagons([...selectedWagons, type]);
    }
  };

  const removeWagon = (index: number) => {
    const copy = [...selectedWagons];
    copy.splice(index, 1);
    setSelectedWagons(copy);
  };

  const finalizeBuild = () => {
    // Generate mission text based on selection
    const count = selectedWagons.length;
    let text = "";
    if (count <= 2) text = "En kort och säker tur till grannbyn.";
    else if (count <= 5) text = "En rejäl leverans! Se upp i backarna.";
    else text = "Ett jättelångt tåg! Här gäller det att vara modig.";
    
    setMissionText(text);
    setPhase('MISSION_INTRO');
  };

  const startDrive = () => {
    // Dynamic Track Length: 
    // Requirement: 5 wagons ~ 60s. 10 wagons ~ 120s.
    // Speed logic: 
    // Physics speed ~30 (on display) -> 30 * 20 (pixels/sec factor) = 600 units/sec.
    // 60 seconds * 600 = 36000 units.
    // Per wagon = 36000 / 5 = 7200 units.
    
    const distancePerWagon = 7200;
    // Ensure a minimum track length for fun even with 1 wagon
    const totalDist = Math.max(7200, selectedWagons.length * distancePerWagon);

    let totalWeight = 2.0; // Loco weight
    const gameWagons = selectedWagons.map((t, i) => {
      totalWeight += WAGON_CONFIG[t].weight;
      return {
        id: `w-${i}`,
        type: t,
        cargoHealth: 100,
        cargoOffset: { x: 0, y: 0 }
      };
    });

    engine.current = {
      ...engine.current,
      active: true,
      distance: 0,
      totalDistance: totalDist,
      speed: 0,
      throttle: 0,
      wagons: gameWagons,
      trainMass: totalWeight,
      lastTime: Date.now(),
      particles: []
    };
    
    setStartTime(Date.now());
    setShowStartHint(true);
    setPhase('DRIVE');
  };

  const calculateScore = () => {
    const W = selectedWagons.length;
    
    // Calculate Average Health (0 to 100)
    const healthSum = engine.current.wagons.reduce((acc, w) => acc + w.cargoHealth, 0);
    const healthPercent = W > 0 ? (healthSum / W) / 100 : 0; // 0.0 to 1.0

    // Time Bonus logic
    // Estimate time: Distance / AvgSpeed
    // If they drive constantly at top speed (~30), they are fast.
    const durationSec = (Date.now() - startTime) / 1000;
    // Target speed approx 28 (slightly less than max 35-40)
    // 28 * 20 = 560 units/sec
    const targetSec = engine.current.totalDistance / 560; 
    
    let S = 0; // Speed factor 0 to 1
    if (durationSec < targetSec) S = 1; // Fast
    else if (durationSec < targetSec * 1.4) S = 0.5; // Okay
    else S = 0.1; // Slow but finished

    // FORMULA: W * (50 + 50*F) + 50*S
    // Base per wagon: 50. Max extra per wagon: 50.
    const wagonPoints = W * 50; // "Modighetsbonus" (Bravery)
    const cargoPoints = Math.round(W * 50 * healthPercent); // "Lastbonus" (Skill)
    const speedPoints = Math.round(50 * S); // "Tidsbonus"

    const total = wagonPoints + cargoPoints + speedPoints;

    // Stars calculation
    // Max possible score approx: W*100 + 50.
    const maxPossible = (W * 100) + 50;
    const ratio = total / maxPossible;
    
    let stars = 1;
    if (ratio > 0.6) stars = 2;
    if (ratio > 0.85) stars = 3;

    setScoreResult({
      total,
      wagonPoints,
      cargoPoints,
      speedPoints,
      wagonsCount: W,
      healthPercent,
      stars
    });
    setPhase('SUMMARY');
  };

  // --- TERRAIN GENERATION ---
  const getTerrainY = (x: number) => {
    // Input x is world coordinate.
    const base = Math.sin(x * 0.0015) * 80; 
    const detail = Math.sin(x * 0.005) * 20;
    return Math.max(0, base + detail + 150);
  };

  const getSlope = (x: number) => {
    // Standard derivative approximation
    return (getTerrainY(x + 10) - getTerrainY(x)) / 10;
  };

  // --- GAME LOOP ---
  useEffect(() => {
    if (phase !== 'DRIVE') return;
    
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    let rafId: number;
    
    const loop = () => {
      if (!engine.current.active) return;
      const state = engine.current;
      const now = Date.now();
      const dt = Math.min((now - state.lastTime) / 1000, 0.1);
      state.lastTime = now;

      // Dimensions
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      const W = canvas.width;
      const H = canvas.height;
      
      if (state.throttle > 0.1) setShowStartHint(false);

      // 1. PHYSICS UPDATE
      // We simulate moving "Left" (Backing up) by increasing positive distance
      // and rendering features as if we are entering positive X coordinates.
      
      const locoWorldPos = state.distance; 
      const currentSlope = getSlope(locoWorldPos);

      // Engine Power
      const power = state.throttle * 800; 
      const gravity = 9.81;
      const slopeForce = Math.sin(Math.atan(currentSlope)) * state.trainMass * gravity * 15; 
      const drag = state.speed * 2; 
      const friction = state.trainMass * 5; 

      const acceleration = (power - slopeForce - drag - friction) / state.trainMass;
      
      state.speed += acceleration * dt;
      if (state.speed < 0 && state.throttle === 0) state.speed = 0; 
      
      state.distance += state.speed * dt * 20; 

      // Wagon Physics
      state.wagons.forEach((w, i) => {
        // Wagons are PUSHED by the locomotive.
        // Movement is Left (Positive World X).
        // Wagons are "Ahead" of the loco in movement direction.
        // Loco is at `state.distance`.
        // Wagon 1 is at `state.distance + 140`.
        
        const wagonWorldX = state.distance + 140 + (i * 130);
        const wSlope = getSlope(wagonWorldX);
        
        // Bouncy logic
        if (w.type === 'BOUNCY') {
          const bump = Math.abs(wSlope) * state.speed * 0.2;
          if (Math.random() < 0.05 && w.cargoOffset.y === 0 && state.speed > 5) {
             w.cargoOffset.y = -bump * 2;
          }
          if (w.cargoOffset.y < 0) {
            w.cargoOffset.y += 30 * dt;
            if (w.cargoOffset.y > 0) w.cargoOffset.y = 0;
          }
          if (w.cargoOffset.y < -25 && w.cargoHealth > 0) {
             w.cargoHealth = Math.max(0, w.cargoHealth - 2);
             state.particles.push({
               x: 0, // Set later based on screen pos
               y: 0,
               vx: (Math.random() - 0.5) * 10, vy: -10, life: 60,
               color: WAGON_CONFIG[w.type].color, size: 5
             });
          }
        }
        
        // Tank logic
        if (w.type === 'TANK') {
           const sway = Math.sin(now * 0.005) * (state.speed * 0.5);
           w.cargoOffset.x = sway;
           if (Math.abs(sway) > 10 && w.cargoHealth > 0) {
             w.cargoHealth -= 0.1;
           }
        }
      });

      // UI Updates (Throttled)
      if (now % 10 === 0) {
        setSpeedDisplay(Math.round(state.speed));
        setProgressDisplay(Math.min(1, state.distance / state.totalDistance));
        setCargoStatus(state.wagons.map(w => w.cargoHealth));
      }

      // Finish Check
      if (state.distance >= state.totalDistance) {
        engine.current.active = false;
        calculateScore();
      }

      // --- DRAWING ---

      // Sky
      const grad = ctx.createLinearGradient(0,0,0,H);
      grad.addColorStop(0, '#38bdf8'); 
      grad.addColorStop(1, '#f0f9ff');
      ctx.fillStyle = grad;
      ctx.fillRect(0,0,W,H);

      // Parallax Clouds
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      for(let i=0; i<6; i++) {
        // Clouds move Right as we move Left
        // state.distance increases => cx increases => moves Right.
        const cx = ((i * 400) + (state.distance * 0.2)) % (W + 400) - 200;
        ctx.beginPath();
        ctx.arc(cx, 80 + (i*30), 50 + (i*10), 0, Math.PI*2);
        ctx.fill();
      }

      // Ground/Terrain
      // NEW: Position train on LEFT HALF of screen.
      // W * 0.45 puts the Locomotive at 45% width.
      // Since wagons are to the LEFT of the Locomotive, they will fill the 0-45% area.
      const LOCO_SCREEN_X = W * 0.45;
      
      ctx.fillStyle = '#e2e8f0'; 
      ctx.beginPath();
      ctx.moveTo(W, H);
      ctx.lineTo(0, H);
      
      const resolution = 20;
      // Loop across screen X
      for(let sx=0; sx<=W+resolution; sx+=resolution) {
         // Backing Up (Moving Left):
         // New terrain enters from Left (sx=0). Old terrain exits Right (sx=W).
         // At sx=LOCO, WorldX = state.distance.
         // At sx=0, WorldX = state.distance + LOCO (Ahead).
         
         const worldX = state.distance + (LOCO_SCREEN_X - sx);
         const y = H - getTerrainY(worldX);
         ctx.lineTo(sx, y);
      }
      ctx.closePath();
      ctx.fill();
      
      // Rails
      ctx.lineWidth = 5;
      ctx.strokeStyle = '#475569';
      ctx.beginPath();
      for(let sx=0; sx<=W+resolution; sx+=resolution) {
         const worldX = state.distance + (LOCO_SCREEN_X - sx);
         const y = H - getTerrainY(worldX);
         if (sx===0) ctx.moveTo(sx, y); else ctx.lineTo(sx, y);
      }
      ctx.stroke();

      // Helper for rotation
      const drawRotated = (x: number, y: number, angle: number, drawFn: () => void) => {
         ctx.save();
         ctx.translate(x, y);
         ctx.rotate(angle); 
         drawFn();
         ctx.restore();
      };

      // DRAW WAGONS (Left of Loco, "Ahead" in world space)
      state.wagons.forEach((w, i) => {
         const gap = 140;
         // Screen pos: Left of Loco
         const wagonScreenX = LOCO_SCREEN_X - 140 - (i * gap);
         // World pos: Ahead (Positive X direction)
         const wagonWorldX = state.distance + 140 + (i * 130);
         
         // Only draw if on screen
         if (wagonScreenX < -150 || wagonScreenX > W + 150) return;

         const slope = getSlope(wagonWorldX);
         const y = H - getTerrainY(wagonWorldX);
         
         drawRotated(wagonScreenX, y - 15, Math.atan(slope), () => {
            // Wheels
            ctx.fillStyle = '#1f2937';
            const wheelRot = state.distance * 0.1; // Positive rotation for backing (CCW)
            const drawWheel = (wx: number) => {
               ctx.beginPath(); ctx.arc(wx, 10, 10, 0, Math.PI*2); ctx.fill();
               ctx.strokeStyle = '#9ca3af'; ctx.lineWidth=2;
               ctx.beginPath(); 
               ctx.moveTo(wx + Math.cos(wheelRot)*10, 10 + Math.sin(wheelRot)*10);
               ctx.lineTo(wx - Math.cos(wheelRot)*10, 10 - Math.sin(wheelRot)*10);
               ctx.stroke();
            };
            drawWheel(-30);
            drawWheel(30);

            // Chassis
            ctx.fillStyle = '#334155';
            ctx.fillRect(-45, -10, 90, 10);

            // Body
            const cfg = WAGON_CONFIG[w.type];
            ctx.fillStyle = cfg.color;

            if (w.type === 'TANK') {
               ctx.beginPath(); ctx.roundRect(-40, -45, 80, 35, 10); ctx.fill();
               ctx.fillStyle = '#93c5fd'; ctx.fillRect(-30, -35, 60, 15);
               const level = (w.cargoHealth/100) * 15;
               ctx.fillStyle = '#2563eb';
               ctx.beginPath();
               ctx.moveTo(-30, -20);
               ctx.lineTo(-30, -20 - level + w.cargoOffset.x);
               ctx.lineTo(30, -20 - level - w.cargoOffset.x);
               ctx.lineTo(30, -20);
               ctx.fill();
            } else if (w.type === 'BOUNCY') {
               ctx.strokeStyle = cfg.color; ctx.lineWidth=3;
               ctx.strokeRect(-40, -45, 80, 35);
               if (w.cargoHealth > 20) {
                  ctx.fillStyle = '#f9a8d4';
                  ctx.beginPath(); ctx.arc(-15, -25 + w.cargoOffset.y, 12, 0, Math.PI*2); ctx.fill();
                  ctx.fillStyle = '#fde047';
                  ctx.beginPath(); ctx.arc(15, -25 + w.cargoOffset.y, 12, 0, Math.PI*2); ctx.fill();
               }
            } else if (w.type === 'HEAVY') {
               ctx.fillStyle = cfg.color;
               ctx.beginPath(); ctx.arc(-20, -25, 12, 0, Math.PI*2); ctx.fill();
               ctx.beginPath(); ctx.arc(0, -25, 12, 0, Math.PI*2); ctx.fill();
               ctx.beginPath(); ctx.arc(20, -25, 12, 0, Math.PI*2); ctx.fill();
               ctx.beginPath(); ctx.arc(-10, -40, 12, 0, Math.PI*2); ctx.fill();
               ctx.beginPath(); ctx.arc(10, -40, 12, 0, Math.PI*2); ctx.fill();
            } else {
               ctx.fillRect(-40, -45, 80, 35);
               ctx.fillStyle = 'rgba(0,0,0,0.2)';
               ctx.fillRect(-30, -40, 60, 25);
            }
         });
         
      });

      // DRAW LOCO (Right side)
      const locoSlope = getSlope(state.distance);
      const locoY = H - getTerrainY(state.distance);

      drawRotated(LOCO_SCREEN_X, locoY - 15, Math.atan(locoSlope), () => {
          // Wheels
          ctx.fillStyle = '#dc2626'; 
          const drawWheel = (wx: number, s: number) => {
             ctx.beginPath(); ctx.arc(wx, 10, s, 0, Math.PI*2); ctx.fill();
             ctx.strokeStyle = 'white'; ctx.lineWidth=2;
             ctx.beginPath(); 
             const rot = state.distance * 0.1; // Positive for backing
             ctx.moveTo(wx + Math.cos(rot)*s, 10 + Math.sin(rot)*s);
             ctx.lineTo(wx - Math.cos(rot)*s, 10 - Math.sin(rot)*s);
             ctx.stroke();
          };
          
          // Orientation: Facing LEFT (Cowcatcher on Left)
          
          drawWheel(20, 14); // Rear (Right)
          drawWheel(-15, 10); 
          drawWheel(-40, 10); // Front (Left)

          // Body
          ctx.fillStyle = '#dc2626'; 
          ctx.fillRect(-50, -45, 90, 45);
          ctx.fillStyle = '#1e293b'; // Roof
          ctx.fillRect(10, -55, 40, 10); // Cab at Rear (Right)
          // Chimney
          ctx.fillStyle = '#0f172a';
          ctx.fillRect(-40, -60, 15, 15); // Front (Left)
          
          // Cowcatcher pointing Left
          ctx.beginPath();
          ctx.moveTo(-50, 0);
          ctx.lineTo(-65, 10);
          ctx.lineTo(-50, 10);
          ctx.fill();
          
          // Smoke (Blowing Right as train moves Left)
          if (state.throttle > 0 && Math.random() > 0.7) {
             state.particles.push({
               x: LOCO_SCREEN_X - 40,
               y: locoY - 60,
               vx: state.speed + 2, // Smoke blows Right
               vy: -2 - Math.random()*2,
               life: 50, color: 'rgba(255,255,255,0.4)', size: 5 + Math.random()*5
             });
          }
      });

      // Particles
      engine.current.particles.forEach((p) => {
         p.x += p.vx + (state.speed * 0.5); 
         p.y += p.vy;
         p.life--;
         ctx.fillStyle = p.color;
         ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI*2); ctx.fill();
      });
      engine.current.particles = engine.current.particles.filter(p => p.life > 0);

      rafId = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(rafId);
  }, [phase]);

  // --- UI RENDER ---

  if (phase === 'BUILD') {
    return (
      <div className="fixed inset-0 z-50 bg-slate-100 flex flex-col animate-fade-in">
        <div className="bg-blue-600 text-white p-4 shadow-lg flex justify-between items-center">
          <h2 className="text-xl md:text-3xl font-black uppercase tracking-wider">Bygg ditt godståg</h2>
          <button onClick={onComplete} className="text-blue-100 hover:text-white font-bold">AVBRYT</button>
        </div>

        <div className="flex-1 relative overflow-hidden flex items-center bg-sky-200">
          <div className="absolute bottom-0 w-full h-1/3 bg-[#e2e8f0] border-t-4 border-[#475569]"></div>
          
          <div className="absolute top-4 md:top-10 left-4 md:left-1/2 md:-translate-x-1/2 z-40 animate-bounce-in">
              <div className="bg-white p-4 rounded-2xl shadow-xl border-b-8 border-slate-200 relative max-w-sm">
                  <div className="absolute -bottom-4 left-8 md:left-1/2 w-6 h-6 bg-white rotate-45 border-r-8 border-b-8 border-slate-200"></div>
                  <p className="font-bold text-slate-800 text-sm md:text-base uppercase">
                     "JAG ORKAR DRA {maxSlots} {maxSlots === 1 ? 'VAGN' : 'VAGNAR'}! DU HAR SAMLAT {maxSlots} ST! <span className="text-yellow-600">FYLL ALLA PLATSERNA!</span>"
                  </p>
              </div>
          </div>

          {/* START BUTTON - Moved here to avoid clipping and ensure visibility */}
          {selectedWagons.length > 0 && (
             <div className="absolute top-[25%] left-1/2 transform -translate-x-1/2 z-50 animate-bounce w-full flex justify-center pointer-events-none">
                <div className="pointer-events-auto">
                    <button 
                      onClick={finalizeBuild}
                      className="bg-green-500 hover:bg-green-600 text-white text-xl md:text-3xl font-black py-3 px-8 md:py-4 md:px-12 rounded-full shadow-2xl border-b-8 border-green-700 active:border-b-0 active:translate-y-2 uppercase tracking-widest whitespace-nowrap"
                    >
                      KÖR TÅGET! ▶
                    </button>
                </div>
             </div>
          )}

          {/* TRAIN PREVIEW (Reversed Order: Wagons -> Loco) */}
          <div className="w-full overflow-x-auto pb-8 pt-4 no-scrollbar">
             <div className="flex items-end justify-center min-w-max px-8 mx-auto gap-1 relative z-10 mb-10">
                
                {/* 1. SLOTS (Left Side) */}
                {Array.from({length: maxSlots}).map((_, i) => {
                   const type = selectedWagons[i];
                   return (
                     <div key={i} className="w-24 h-24 md:w-32 md:h-32 relative flex items-end justify-center">
                        {type ? (
                          <div 
                            className="w-full h-24 md:h-32 rounded-lg shadow-xl border-4 border-white relative hover:scale-105 transition-transform cursor-pointer animate-bounce-in"
                            style={{backgroundColor: WAGON_CONFIG[type].color}}
                            onClick={() => removeWagon(i)}
                          >
                             <div className="absolute inset-0 flex items-center justify-center text-5xl md:text-6xl drop-shadow-md">
                               {WAGON_CONFIG[type].icon}
                             </div>
                             <div className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold border-2 border-white shadow-sm">✕</div>
                          </div>
                        ) : (
                          <div className="w-full h-20 md:h-24 bg-black/10 border-4 border-dashed border-slate-400/50 rounded-xl flex items-center justify-center text-slate-400 font-bold text-xs md:text-sm uppercase">
                             PLATS {i+1}
                          </div>
                        )}
                        {/* Connector */}
                        <div className="absolute right-[-6px] bottom-4 w-4 h-2 bg-slate-700"></div>
                     </div>
                   );
                })}

                {/* 2. LOKET (Right Side) */}
                <div className="relative w-32 h-32 md:w-40 md:h-40 flex-shrink-0 transform scale-x-[-1]"> 
                   {/* Flipped visually to face Left, but placed on Right */}
                   <div className="absolute bottom-2 right-0 w-full h-3/4 bg-red-600 rounded-l-xl shadow-xl border-4 border-red-800 z-20"></div>
                   <div className="absolute bottom-2 right-0 w-1/2 h-full bg-slate-800 rounded-t-lg z-10"></div>
                   <div className="absolute bottom-2 left-0 w-10 h-10 bg-slate-900 skew-x-12"></div> 
                </div>
             </div>
          </div>
        </div>

        <div className="bg-white p-4 md:p-6 border-t-4 border-slate-300 shadow-up-lg">
           <div className="grid grid-cols-4 gap-2 md:gap-4 max-w-4xl mx-auto">
              {(Object.keys(WAGON_CONFIG) as WagonType[]).map(t => (
                <button 
                   key={t}
                   onClick={() => addWagon(t)}
                   disabled={selectedWagons.length >= maxSlots}
                   className="group relative flex flex-col items-center bg-slate-50 p-2 md:p-4 rounded-xl border-2 border-slate-200 hover:border-blue-400 hover:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 transition-all"
                >
                   <div className="text-4xl md:text-5xl mb-2 group-hover:scale-110 transition-transform">{WAGON_CONFIG[t].icon}</div>
                   <div className="font-black text-slate-700 text-xs md:text-sm uppercase">{WAGON_CONFIG[t].name}</div>
                   <span className="absolute top-2 right-2 text-[10px] font-bold bg-yellow-100 text-yellow-800 px-1 rounded">
                      {WAGON_CONFIG[t].effect}
                   </span>
                </button>
              ))}
           </div>
        </div>
      </div>
    );
  }

  if (phase === 'MISSION_INTRO') {
     return (
       <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-3xl p-8 max-w-lg w-full text-center border-8 border-yellow-400 shadow-2xl relative">
             <div className="text-6xl mb-4 animate-pulse">📜</div>
             <h2 className="text-3xl font-black text-slate-800 mb-4 uppercase">DITT UPPDRAG</h2>
             <p className="text-xl font-bold text-slate-600 mb-8 leading-relaxed uppercase">
               {missionText}
             </p>
             <button 
               onClick={startDrive}
               className="bg-blue-600 hover:bg-blue-700 text-white text-2xl font-black py-4 px-12 rounded-xl shadow-lg uppercase w-full"
             >
               JAG FÖRSTÅR!
             </button>
          </div>
       </div>
     );
  }

  if (phase === 'SUMMARY' && scoreResult) {
     return (
        <div className="fixed inset-0 z-50 bg-blue-500 flex items-center justify-center p-4 animate-fade-in">
           <div className="bg-white rounded-3xl p-6 md:p-8 max-w-2xl w-full shadow-2xl border-8 border-blue-300 relative overflow-hidden">
              <div className="absolute inset-0 bg-yellow-50 -rotate-12 scale-150 -z-10"></div>
              
              <h2 className="text-4xl font-black text-slate-800 mb-2 uppercase text-center">FRAMME!</h2>
              
              <div className="flex justify-center gap-2 mb-6">
                 {[1,2,3].map(i => (
                    <span key={i} className={`text-6xl transform transition-all duration-500 ${i <= scoreResult.stars ? 'scale-110 opacity-100' : 'scale-90 opacity-30 grayscale'}`}>
                       ⭐
                    </span>
                 ))}
              </div>

              {/* SCORE BREAKDOWN */}
              <div className="space-y-3 mb-8">
                 <div className="flex justify-between items-center bg-slate-100 p-3 rounded-xl border-2 border-slate-200">
                    <div className="flex items-center gap-3">
                       <span className="text-2xl">💪</span>
                       <div>
                          <div className="font-black text-slate-700 uppercase text-sm">Modighetsbonus</div>
                          <div className="text-xs text-slate-500">{scoreResult.wagonsCount} vagnar x 50</div>
                       </div>
                    </div>
                    <div className="font-black text-xl text-green-600">+{scoreResult.wagonPoints}</div>
                 </div>

                 <div className="flex justify-between items-center bg-slate-100 p-3 rounded-xl border-2 border-slate-200">
                    <div className="flex items-center gap-3">
                       <span className="text-2xl">📦</span>
                       <div>
                          <div className="font-black text-slate-700 uppercase text-sm">Lastbonus</div>
                          <div className="text-xs text-slate-500">{Math.round(scoreResult.healthPercent * 100)}% helt</div>
                       </div>
                    </div>
                    <div className="font-black text-xl text-green-600">+{scoreResult.cargoPoints}</div>
                 </div>

                 <div className="flex justify-between items-center bg-slate-100 p-3 rounded-xl border-2 border-slate-200">
                    <div className="flex items-center gap-3">
                       <span className="text-2xl">⚡</span>
                       <div>
                          <div className="font-black text-slate-700 uppercase text-sm">Tidsbonus</div>
                          <div className="text-xs text-slate-500">Snabb leverans</div>
                       </div>
                    </div>
                    <div className="font-black text-xl text-green-600">+{scoreResult.speedPoints}</div>
                 </div>
                 
                 <div className="border-t-4 border-slate-200 pt-2 flex justify-between items-center px-2">
                    <span className="font-black text-2xl text-slate-800 uppercase">TOTALT:</span>
                    <span className="font-black text-4xl text-yellow-500 drop-shadow-sm">{scoreResult.total} 🪙</span>
                 </div>
              </div>

              <button 
                onClick={onComplete}
                className="bg-green-500 hover:bg-green-600 text-white text-2xl font-black py-4 px-12 rounded-full shadow-xl border-b-8 border-green-700 active:border-b-0 active:translate-y-2 transition-all uppercase w-full"
              >
                 TACK FÖR PENGARNA!
              </button>
           </div>
        </div>
     );
  }

  // DRIVE PHASE UI
  return (
    <div className="fixed inset-0 z-50 bg-slate-900 overflow-hidden touch-none select-none">
      <canvas ref={canvasRef} className="block w-full h-full" />
      
      {/* HUD */}
      <div className="absolute top-4 left-4 right-4 flex justify-between pointer-events-none">
         <div className="bg-white/90 backdrop-blur px-4 py-2 rounded-xl border-4 border-slate-200 shadow-lg">
            <div className="text-[10px] font-bold text-slate-400 uppercase">FART</div>
            <div className="text-2xl font-black font-mono text-slate-800">{speedDisplay}</div>
         </div>
         
         <div className="bg-white/90 backdrop-blur px-4 py-2 rounded-xl border-4 border-slate-200 shadow-lg w-1/2">
             <div className="text-[10px] font-bold text-slate-400 uppercase mb-1 flex justify-between">
                <span>RESA</span>
                <span>{Math.round(progressDisplay * 100)}%</span>
             </div>
             <div className="w-full h-3 bg-slate-200 rounded-full overflow-hidden">
                <div className="h-full bg-blue-500 transition-all duration-300" style={{width: `${progressDisplay * 100}%`}}></div>
             </div>
         </div>
      </div>

      {/* START HINT */}
      {showStartHint && (
         <div className="absolute bottom-40 right-6 animate-bounce pointer-events-none">
            <div className="bg-white text-blue-800 font-black px-4 py-2 rounded-xl shadow-xl border-4 border-blue-300 text-center uppercase">
               Dra i spaken<br/>för att backa! 👇
            </div>
         </div>
      )}

      {/* CONTROLS */}
      <div className="absolute bottom-6 right-6 flex flex-col items-center gap-2">
         <div className="text-white font-black text-xl tracking-widest drop-shadow-md">GASA</div>
         <input 
           type="range" min="0" max="1" step="0.01" defaultValue="0"
           className="h-48 w-24 accent-green-500 cursor-pointer"
           style={{ writingMode: 'vertical-lr', direction: 'rtl', appearance: 'slider-vertical' as any }}
           onChange={(e) => engine.current.throttle = parseFloat(e.target.value)}
           onTouchMove={(e) => e.stopPropagation()}
         />
      </div>
      
      {/* WARNINGS */}
      <div className="absolute top-1/2 w-full text-center pointer-events-none">
         {cargoStatus.some(h => h < 50) && (
            <div className="text-red-500 font-black text-4xl animate-ping drop-shadow-lg">
               OJ! DET SKAKAR!
            </div>
         )}
      </div>
    </div>
  );
};