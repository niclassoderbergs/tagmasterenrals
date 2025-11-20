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
    effect: 'Inga konstigheter',
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
    effect: 'Ger GULD-bonus',
    weight: 2.5
  },
  'TANK': { 
    name: 'TANKVAGN', 
    color: '#1d4ed8', // Blue
    icon: '🛢️', 
    desc: 'Vätska skvimpar.',
    effect: 'Bromsa lugnt',
    weight: 1.2
  }
};

const MAX_SLOTS = 4;

export const TrainDeliveryGame: React.FC<TrainDeliveryGameProps> = ({ onComplete }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // STATE
  const [phase, setPhase] = useState<'BUILD' | 'MISSION_INTRO' | 'DRIVE' | 'SUMMARY'>('BUILD');
  const [selectedWagons, setSelectedWagons] = useState<WagonType[]>([]);
  const [missionText, setMissionText] = useState("");
  
  // GAME STATS (For React UI overlays)
  const [speedDisplay, setSpeedDisplay] = useState(0);
  const [progressDisplay, setProgressDisplay] = useState(0);
  const [cargoStatus, setCargoStatus] = useState<number[]>([]); // 0-100 per wagon
  const [showStartHint, setShowStartHint] = useState(false);
  
  // PHYSICS ENGINE STATE (Mutable ref for 60fps loop)
  const engine = useRef({
    active: false,
    distance: 0,
    totalDistance: 10000,
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
    if (selectedWagons.length < MAX_SLOTS) {
      setSelectedWagons([...selectedWagons, type]);
    }
  };

  const removeWagon = (index: number) => {
    const copy = [...selectedWagons];
    copy.splice(index, 1);
    setSelectedWagons(copy);
  };

  const finalizeBuild = () => {
    // Generate mission text
    const counts = selectedWagons.reduce((acc, type) => ({...acc, [type]: (acc[type]||0)+1}), {} as Record<string, number>);
    let text = "Uppdrag: Leverera ";
    if (counts['BOUNCY']) text += "känsliga kalas-saker ";
    if (counts['HEAVY']) text += "och tungt timmer ";
    if (counts['TANK']) text += "och saft ";
    if (counts['BOX']) text += "och viktiga lådor ";
    text += "till bergsbyn!";
    
    setMissionText(text);
    setPhase('MISSION_INTRO');
  };

  const startDrive = () => {
    // Init physics
    let totalWeight = 1.5; // Loco weight
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
      speed: 0,
      throttle: 0,
      wagons: gameWagons,
      trainMass: totalWeight,
      lastTime: Date.now(),
      particles: []
    };
    
    setShowStartHint(true);
    setPhase('DRIVE');
  };

  // --- TERRAIN GENERATION ---
  // Returns height (y-offset from bottom) at world x
  const getTerrainY = (x: number) => {
    // Smooth rolling hills
    const base = Math.sin(x * 0.0015) * 80; 
    const detail = Math.sin(x * 0.005) * 20;
    return Math.max(0, base + detail + 150); // 150 is base height
  };

  const getSlope = (x: number) => {
    return (getTerrainY(x + 10) - getTerrainY(x)) / 10;
  };

  // --- GAME LOOP ---
  useEffect(() => {
    if (phase !== 'DRIVE') return;
    
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false }); // Optimization
    if (!ctx) return;

    let rafId: number;
    
    const loop = () => {
      if (!engine.current.active) return;
      const state = engine.current;
      const now = Date.now();
      const dt = Math.min((now - state.lastTime) / 1000, 0.1); // Cap delta time
      state.lastTime = now;

      // Dimensions
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      const W = canvas.width;
      const H = canvas.height;
      
      // Hint Logic
      if (state.throttle > 0.1) setShowStartHint(false);

      // 1. TRAIN PHYSICS
      // Look ahead for loco slope
      const locoX = state.distance + 500; // Loco is "ahead" in distance terms
      const currentSlope = getSlope(locoX);

      // Engine Power vs Weight
      const power = state.throttle * 800; // Engine force
      const gravity = 9.81;
      const slopeForce = Math.sin(Math.atan(currentSlope)) * state.trainMass * gravity * 15; // Gravity pull on slope
      const drag = state.speed * 2; // Air resistance
      const friction = state.trainMass * 2; // Rolling resistance

      const acceleration = (power - slopeForce - drag - friction) / state.trainMass;
      
      state.speed += acceleration * dt;
      if (state.speed < 0 && state.throttle === 0) state.speed = 0; // No rolling back for simplicity
      
      // Move
      state.distance += state.speed * dt * 20; // Scale factor

      // 2. WAGON PHYSICS
      state.wagons.forEach((w, i) => {
        const wagonX = locoX - 140 - (i * 130); // Position relative to loco
        const wSlope = getSlope(wagonX);
        
        // Bouncy
        if (w.type === 'BOUNCY') {
          const bump = Math.abs(wSlope) * state.speed * 0.2;
          if (Math.random() < 0.05 && w.cargoOffset.y === 0 && state.speed > 5) {
             w.cargoOffset.y = -bump * 2; // Pop up
          }
          // Gravity return
          if (w.cargoOffset.y < 0) {
            w.cargoOffset.y += 30 * dt;
            if (w.cargoOffset.y > 0) w.cargoOffset.y = 0;
          }
          // Check loss
          if (w.cargoOffset.y < -25 && w.cargoHealth > 0) {
             w.cargoHealth = Math.max(0, w.cargoHealth - 2);
             // Spawn particles
             state.particles.push({
               x: (W * 0.2) + (i + 1) * 130, // Approx screen pos (rough)
               y: H - getTerrainY(wagonX) - 50,
               vx: (Math.random() - 0.5) * 10,
               vy: -10,
               life: 60,
               color: WAGON_CONFIG[w.type].color,
               size: 5
             });
          }
        }
        
        // Tank
        if (w.type === 'TANK') {
           // Slosh based on acceleration change (jerk) or just simple sway
           const sway = Math.sin(now * 0.005) * (state.speed * 0.5);
           w.cargoOffset.x = sway;
           // Spill if fast + braking or fast + steep slope
           if (Math.abs(sway) > 10 && w.cargoHealth > 0) {
             w.cargoHealth -= 0.1;
             if (Math.random() < 0.1) {
                state.particles.push({
                  x: (W * 0.2) + (i + 1) * 130,
                  y: H - getTerrainY(wagonX) - 30,
                  vx: -5, vy: 5, life: 20, color: '#60a5fa', size: 3
                });
             }
           }
        }
      });

      // 3. UPDATE UI STATE (Throttled)
      if (now % 10 === 0) {
        setSpeedDisplay(Math.round(state.speed));
        setProgressDisplay(state.distance / state.totalDistance);
        setCargoStatus(state.wagons.map(w => w.cargoHealth));
      }

      // CHECK FINISH
      if (state.distance >= state.totalDistance) {
        engine.current.active = false;
        setPhase('SUMMARY');
      }

      // --- DRAWING ---

      // Sky
      const grad = ctx.createLinearGradient(0,0,0,H);
      grad.addColorStop(0, '#0ea5e9'); // Sky blue
      grad.addColorStop(1, '#e0f2fe');
      ctx.fillStyle = grad;
      ctx.fillRect(0,0,W,H);

      // Clouds (Parallax)
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      for(let i=0; i<5; i++) {
        const cx = ((i * 300) + (state.distance * 0.1)) % (W + 200) - 200;
        ctx.beginPath();
        ctx.arc(W - cx, 100 + (i*20), 40 + (i*10), 0, Math.PI*2);
        ctx.fill();
      }

      // Terrain
      const resolution = 20;
      
      // Draw Ground
      ctx.fillStyle = '#e2e8f0'; // Ground base
      ctx.beginPath();
      ctx.moveTo(W, H);
      ctx.lineTo(0, H);
      for(let x=0; x<=W+resolution; x+=resolution) {
         const worldX = state.distance + 500 - x;
         const y = H - getTerrainY(worldX);
         ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      
      // Draw Rails
      ctx.lineWidth = 5;
      ctx.strokeStyle = '#475569';
      ctx.beginPath();
      for(let x=0; x<=W+resolution; x+=resolution) {
         const worldX = state.distance + 500 - x;
         const y = H - getTerrainY(worldX);
         if (x===0) ctx.moveTo(x, y);
         else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // --- DRAW TRAIN ---
      const LOCO_SCREEN_X = 200;
      
      const drawRotated = (x: number, y: number, angle: number, drawFn: () => void) => {
         ctx.save();
         ctx.translate(x, y);
         ctx.rotate(-angle); // Negative rotation to match slope visual (Moving Left)
         drawFn();
         ctx.restore();
      };

      // Draw Wagons (from Right to Left visually - Behind the loco)
      state.wagons.forEach((w, i) => {
         const gap = 140;
         const wagonScreenX = LOCO_SCREEN_X + 140 + (i * gap);
         const wagonWorldX = state.distance + 500 - wagonScreenX;
         const groundY = H - getTerrainY(wagonWorldX);
         const slope = getSlope(wagonWorldX);
         const angle = Math.atan(slope);

         drawRotated(wagonScreenX, groundY - 15, angle, () => {
            // Wheels
            ctx.fillStyle = '#1f2937';
            const wheelRot = state.distance * 0.1;
            const drawWheel = (wx: number) => {
               ctx.beginPath(); ctx.arc(wx, 10, 10, 0, Math.PI*2); ctx.fill();
               // Spokes
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
               // Liquid window
               ctx.fillStyle = '#93c5fd'; ctx.fillRect(-30, -35, 60, 15);
               // Liquid
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
               // Balls
               if (w.cargoHealth > 20) {
                  ctx.fillStyle = '#f9a8d4';
                  ctx.beginPath(); ctx.arc(-15, -25 + w.cargoOffset.y, 12, 0, Math.PI*2); ctx.fill();
                  ctx.fillStyle = '#fde047';
                  ctx.beginPath(); ctx.arc(15, -25 + w.cargoOffset.y, 12, 0, Math.PI*2); ctx.fill();
               }
            } else if (w.type === 'HEAVY') {
               ctx.fillStyle = cfg.color;
               // Logs
               ctx.beginPath(); ctx.arc(-20, -25, 12, 0, Math.PI*2); ctx.fill();
               ctx.beginPath(); ctx.arc(0, -25, 12, 0, Math.PI*2); ctx.fill();
               ctx.beginPath(); ctx.arc(20, -25, 12, 0, Math.PI*2); ctx.fill();
               ctx.beginPath(); ctx.arc(-10, -40, 12, 0, Math.PI*2); ctx.fill();
               ctx.beginPath(); ctx.arc(10, -40, 12, 0, Math.PI*2); ctx.fill();
            } else {
               // Box
               ctx.fillRect(-40, -45, 80, 35);
               ctx.fillStyle = 'rgba(0,0,0,0.2)';
               ctx.fillRect(-30, -40, 60, 25); // Detail
            }
         });
      });

      // Draw LOCO (Front Left)
      const locoWorldPos = state.distance + 300; // Ahead of 200 screen X in world space
      // ScreenX=200 -> World = Dist + 500 - 200 = Dist + 300. Correct.
      const locoSlope = getSlope(locoWorldPos);
      
      drawRotated(LOCO_SCREEN_X, H - getTerrainY(locoWorldPos) - 15, Math.atan(locoSlope), () => {
          // Wheels
          ctx.fillStyle = '#dc2626'; // Red wheels
          const drawWheel = (wx: number, s: number) => {
             ctx.beginPath(); ctx.arc(wx, 10, s, 0, Math.PI*2); ctx.fill();
             ctx.strokeStyle = 'white'; ctx.lineWidth=2;
             ctx.beginPath(); 
             const rot = state.distance * 0.1;
             ctx.moveTo(wx + Math.cos(rot)*s, 10 + Math.sin(rot)*s);
             ctx.lineTo(wx - Math.cos(rot)*s, 10 - Math.sin(rot)*s);
             ctx.stroke();
          };
          drawWheel(20, 14); // Big rear
          drawWheel(-15, 10); // Small front
          drawWheel(-40, 10);

          // Body
          ctx.fillStyle = '#dc2626'; // Red
          ctx.fillRect(-50, -45, 90, 45);
          ctx.fillStyle = '#1e293b'; // Cab roof
          ctx.fillRect(10, -55, 40, 10);
          // Chimney
          ctx.fillStyle = '#0f172a';
          ctx.fillRect(-40, -60, 15, 15);
          
          // Pilot (Cowcatcher) - pointing Left
          ctx.beginPath();
          ctx.moveTo(-50, 0);
          ctx.lineTo(-65, 10);
          ctx.lineTo(-50, 10);
          ctx.fill();
          
          // Smoke
          if (state.throttle > 0 && Math.random() > 0.7) {
             state.particles.push({
               x: LOCO_SCREEN_X - 40,
               y: H - getTerrainY(locoWorldPos) - 60,
               vx: -state.speed - 2, // Blow back
               vy: -2 - Math.random()*2,
               life: 50, color: 'rgba(255,255,255,0.4)', size: 5 + Math.random()*5
             });
          }
      });

      // 4. PARTICLES
      engine.current.particles.forEach((p, i) => {
         p.x += p.vx + (state.speed * 0.5); // Move with world (parallax effect)
         p.y += p.vy;
         p.life--;
         ctx.fillStyle = p.color;
         ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI*2); ctx.fill();
      });
      // Remove dead
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
        {/* HEADER */}
        <div className="bg-blue-600 text-white p-4 shadow-lg flex justify-between items-center">
          <h2 className="text-xl md:text-3xl font-black uppercase tracking-wider">Bygg ditt godståg</h2>
          <button onClick={onComplete} className="text-blue-100 hover:text-white font-bold">AVBRYT</button>
        </div>

        {/* TRAIN PREVIEW AREA */}
        <div className="flex-1 relative overflow-hidden flex items-center bg-sky-200">
          {/* Background hints */}
          <div className="absolute bottom-0 w-full h-1/3 bg-[#e2e8f0] border-t-4 border-[#475569]"></div>
          
          {/* CONDUCTOR BUBBLE (New) */}
          <div className="absolute top-4 md:top-10 left-4 md:left-1/2 md:-translate-x-1/2 z-40 animate-bounce-in">
              <div className="bg-white p-4 rounded-2xl shadow-xl border-b-8 border-slate-200 relative max-w-xs">
                  <div className="absolute -bottom-4 left-8 md:left-1/2 w-6 h-6 bg-white rotate-45 border-r-8 border-b-8 border-slate-200"></div>
                  <p className="font-bold text-slate-800 text-sm md:text-base uppercase">
                     "Ditt lok orkar dra <span className="text-blue-600 text-xl">{MAX_SLOTS} vagnar</span> på den här banan. Välj noga!"
                  </p>
              </div>
          </div>

          <div className="flex items-end justify-center w-full max-w-6xl mx-auto px-4 relative z-10 mb-10 md:mb-20 gap-1">
             
             {/* 1. LOKET */}
             <div className="relative w-32 h-32 md:w-40 md:h-40 flex-shrink-0">
                <div className="absolute bottom-2 right-0 w-full h-3/4 bg-red-600 rounded-l-xl shadow-xl border-4 border-red-800 z-20"></div>
                <div className="absolute bottom-2 right-0 w-1/2 h-full bg-slate-800 rounded-t-lg z-10"></div>
                <div className="absolute bottom-2 left-0 w-10 h-10 bg-slate-900 skew-x-12"></div> 
                <div className="absolute bottom-8 left-4 text-4xl md:text-6xl z-30">👨‍✈️</div>
             </div>

             {/* 2. SLOTS */}
             {Array.from({length: MAX_SLOTS}).map((_, i) => {
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
                          VAGN {i+1}
                       </div>
                     )}
                     {/* Connector */}
                     <div className="absolute left-[-6px] bottom-4 w-4 h-2 bg-slate-700"></div>
                  </div>
                );
             })}
             
             {/* START BUTTON */}
             {selectedWagons.length === MAX_SLOTS && (
                <div className="absolute -top-32 left-1/2 transform -translate-x-1/2 animate-bounce">
                   <button 
                     onClick={finalizeBuild}
                     className="bg-green-500 hover:bg-green-600 text-white text-2xl md:text-4xl font-black py-4 px-12 rounded-full shadow-2xl border-b-8 border-green-700 active:border-b-0 active:translate-y-2 uppercase tracking-widest whitespace-nowrap"
                   >
                     KÖR TÅGET! ▶
                   </button>
                </div>
             )}
          </div>
        </div>

        {/* COLLECTION DECK */}
        <div className="bg-white p-4 md:p-6 border-t-4 border-slate-300 shadow-up-lg">
           <h3 className="text-center text-slate-400 font-bold uppercase text-sm mb-4 tracking-widest">VÄLJ VAGNAR FRÅN DIN SAMLING</h3>
           <div className="grid grid-cols-4 gap-2 md:gap-4 max-w-4xl mx-auto">
              {(Object.keys(WAGON_CONFIG) as WagonType[]).map(t => (
                <button 
                   key={t}
                   onClick={() => addWagon(t)}
                   disabled={selectedWagons.length >= MAX_SLOTS}
                   className="group relative flex flex-col items-center bg-slate-50 p-2 md:p-4 rounded-xl border-2 border-slate-200 hover:border-blue-400 hover:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 transition-all"
                >
                   <div className="text-4xl md:text-5xl mb-2 group-hover:scale-110 transition-transform">{WAGON_CONFIG[t].icon}</div>
                   <div className="font-black text-slate-700 text-xs md:text-sm uppercase">{WAGON_CONFIG[t].name}</div>
                   <div className="text-[10px] md:text-xs text-slate-500 mt-1 leading-tight">{WAGON_CONFIG[t].desc}</div>
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

  if (phase === 'SUMMARY') {
     const score = cargoStatus.reduce((a,b) => a+b, 0) / cargoStatus.length;
     const isGold = score > 80;
     
     return (
        <div className="fixed inset-0 z-50 bg-green-500 flex items-center justify-center p-4 animate-fade-in">
           <div className="bg-white rounded-3xl p-8 max-w-2xl w-full text-center shadow-2xl border-8 border-green-300 relative overflow-hidden">
              <div className="absolute inset-0 bg-yellow-50 -rotate-12 scale-150 -z-10"></div>
              
              <div className="text-8xl mb-2 animate-bounce">{isGold ? '🏆' : '⭐'}</div>
              <h2 className="text-4xl font-black text-slate-800 mb-2 uppercase">FRAMME!</h2>
              <p className="text-slate-500 font-bold uppercase mb-6">Vilken resa!</p>

              <div className="flex justify-center gap-4 mb-8">
                 {selectedWagons.map((t, i) => (
                    <div key={i} className="flex flex-col items-center">
                       <div className="text-4xl mb-2">{WAGON_CONFIG[t].icon}</div>
                       <div className="h-2 w-16 bg-slate-200 rounded-full overflow-hidden border border-slate-300">
                          <div className={`h-full ${cargoStatus[i] > 50 ? 'bg-green-500' : 'bg-red-500'}`} style={{width: `${cargoStatus[i]}%`}}></div>
                       </div>
                    </div>
                 ))}
              </div>

              <button 
                onClick={onComplete}
                className="bg-yellow-400 hover:bg-yellow-500 text-yellow-900 text-2xl font-black py-4 px-12 rounded-full shadow-xl border-b-8 border-yellow-600 active:border-b-0 active:translate-y-2 transition-all uppercase w-full"
              >
                 HÄMTA BELÖNING
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
               Dra i spaken<br/>för att köra! 👇
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