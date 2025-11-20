import React, { useEffect, useRef, useState } from 'react';
import { TrainCar } from '../types';

// --- TYPES FOR THE MINIGAME ---
type WagonType = 'BOX' | 'BOUNCY' | 'HEAVY' | 'TANK';

interface GameWagon {
  id: string;
  type: WagonType;
  cargoHealth: number; // 0-100%
  cargoOffset: { x: number, y: number }; // For animation (bouncing/sloshing)
}

interface TrainDeliveryGameProps {
  cars: TrainCar[]; // We ignore these for the building phase, or treat them as "collection" source
  onComplete: () => void;
}

// --- WAGON CONFIGURATION ---
const WAGON_CONFIG: Record<WagonType, { 
  name: string; 
  color: string; 
  icon: string; 
  desc: string;
  perk: string;
}> = {
  'BOX': { 
    name: 'LÅDVAGN', 
    color: '#16a34a', // Green
    icon: '📦', 
    desc: 'Stabil och bra.',
    perk: 'Säkert val'
  },
  'BOUNCY': { 
    name: 'STUDSVAGN', 
    color: '#db2777', // Pink
    icon: '🎈', 
    desc: 'Lasten studsar!',
    perk: 'Extra poäng'
  },
  'HEAVY': { 
    name: 'TUNG VAGN', 
    color: '#78350f', // Brown/Wood
    icon: '🪵', 
    desc: 'Tung i backarna.',
    perk: 'Mynt-bonus'
  },
  'TANK': { 
    name: 'TANKVAGN', 
    color: '#2563eb', // Blue
    icon: '🛢️', 
    desc: 'Skvimpar mycket.',
    perk: 'Vatten-leverans'
  }
};

export const TrainDeliveryGame: React.FC<TrainDeliveryGameProps> = ({ onComplete }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // PHASE: 'BUILD' | 'DRIVE' | 'SUMMARY'
  const [phase, setPhase] = useState<'BUILD' | 'DRIVE' | 'SUMMARY'>('BUILD');
  
  // BUILD STATE
  const MAX_SLOTS = 4;
  const [selectedWagons, setSelectedWagons] = useState<WagonType[]>([]);

  // DRIVE STATE (React state for UI overlays)
  const [speedDisplay, setSpeedDisplay] = useState(0);
  const [distanceDisplay, setDistanceDisplay] = useState(0);
  const [totalDistance] = useState(10000); // Length of track
  
  // GAME LOOP REFS (Mutable state for performance)
  const gameState = useRef({
    distance: 0,
    speed: 0,
    throttle: 0, // 0 to 1
    wagons: [] as GameWagon[],
    terrainSeed: Math.random(),
    particles: [] as {x: number, y: number, vx: number, vy: number, life: number, color: string}[],
    startTime: 0
  });

  // --- BUILDER FUNCTIONS ---
  const addWagon = (type: WagonType) => {
    if (selectedWagons.length < MAX_SLOTS) {
      setSelectedWagons([...selectedWagons, type]);
    }
  };

  const removeWagon = (index: number) => {
    const newWagons = [...selectedWagons];
    newWagons.splice(index, 1);
    setSelectedWagons(newWagons);
  };

  const startGame = () => {
    // Init physics state
    gameState.current.wagons = selectedWagons.map((type, i) => ({
      id: `w-${i}`,
      type,
      cargoHealth: 100,
      cargoOffset: { x: 0, y: 0 }
    }));
    gameState.current.distance = 0;
    gameState.current.speed = 0;
    gameState.current.startTime = Date.now();
    setPhase('DRIVE');
  };

  // --- PHYSICS ENGINE ---
  
  // Generate terrain height at specific X distance
  const getTerrainHeight = (x: number) => {
    // Mix of sine waves for hills
    const base = Math.sin(x * 0.002) * 60; // Big hills
    const detail = Math.sin(x * 0.01) * 10; // Small bumps
    return base + detail + 100; // Offset from bottom
  };

  const getSlope = (x: number) => {
    // Derivative approximation
    const h1 = getTerrainHeight(x);
    const h2 = getTerrainHeight(x + 10);
    return (h2 - h1) / 10;
  };

  useEffect(() => {
    if (phase !== 'DRIVE') return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;

    const loop = () => {
      const state = gameState.current;
      const w = canvas.width = window.innerWidth;
      const h = canvas.height = window.innerHeight;
      
      // 1. PHYSICS UPDATE
      
      // Calculate Train Physics
      const slope = getSlope(state.distance + 300); // Look ahead slightly (loco position)
      
      // Weight calc
      let weightFactor = 1;
      state.wagons.forEach(w => {
        if (w.type === 'HEAVY') weightFactor += 0.5; // Heavy wagons add drag
      });

      // Acceleration
      const targetSpeed = state.throttle * (12 / Math.max(1, (slope > 0 ? weightFactor * 1.5 : 1))); 
      // Slower acceleration, faster deceleration
      if (state.speed < targetSpeed) {
        state.speed += 0.05;
      } else {
        state.speed -= 0.1;
      }
      
      // Gravity/Slope effect
      state.speed -= slope * 0.1 * weightFactor;

      // Min/Max clamp
      state.speed = Math.max(0, Math.min(state.speed, 15));
      
      state.distance += state.speed;

      // Update React UI infrequently
      if (state.distance % 10 < 1) {
        setSpeedDisplay(Math.round(state.speed));
        setDistanceDisplay(Math.round((state.distance / totalDistance) * 100));
      }

      // Check Finish
      if (state.distance >= totalDistance) {
        setPhase('SUMMARY');
        return; // Stop loop
      }

      // 2. WAGON PHYSICS (Bouncing, Sloshing)
      state.wagons.forEach((wagon, i) => {
         const wagonX = state.distance - (i * 110) - 150; // Virtual X position on track
         const localSlope = getSlope(wagonX);
         
         if (wagon.type === 'BOUNCY') {
            // Bounce based on speed + slope change (bumps)
            const bumpiness = Math.abs(localSlope) * state.speed * 0.5;
            
            // Add random bounce impulse
            if (Math.random() < 0.05 * bumpiness && wagon.cargoOffset.y === 0) {
               wagon.cargoOffset.y = -10 - (Math.random() * state.speed * 2);
            }
            
            // Gravity for cargo
            if (wagon.cargoOffset.y < 0) {
               wagon.cargoOffset.y += 1; // Fall down
               if (wagon.cargoOffset.y > 0) wagon.cargoOffset.y = 0;
            }

            // Cargo loss logic
            if (wagon.cargoOffset.y < -40 && wagon.cargoHealth > 0) {
               wagon.cargoHealth -= 10; // Lost some balls
               // Spawn particles
               for(let p=0; p<3; p++) {
                 state.particles.push({
                    x: 400 - (i * 100), // Screen X approx
                    y: h - 150 + wagon.cargoOffset.y,
                    vx: -5 + Math.random() * 2,
                    vy: -5 + Math.random() * 5,
                    life: 50,
                    color: '#ec4899'
                 });
               }
            }
         } else if (wagon.type === 'TANK') {
            // Slosh based on acceleration (change in speed)
            // Simplified: Slosh based on current speed vs ideal
            const slosh = (state.speed * 0.5) + (slope * 5);
            wagon.cargoOffset.x = Math.sin(Date.now() / 200) * slosh;
            
            if (Math.abs(slosh) > 8 && wagon.cargoHealth > 0) {
               wagon.cargoHealth -= 0.2; // Leaking
               if (Math.random() < 0.3) {
                  state.particles.push({
                    x: 400 - (i * 100),
                    y: h - 140,
                    vx: -2,
                    vy: 2,
                    life: 30,
                    color: '#60a5fa'
                 });
               }
            }
         }
      });

      // 3. DRAWING

      // Clear
      const skyGrad = ctx.createLinearGradient(0, 0, 0, h);
      skyGrad.addColorStop(0, '#60a5fa');
      skyGrad.addColorStop(1, '#bfdbfe');
      ctx.fillStyle = skyGrad;
      ctx.fillRect(0, 0, w, h);

      // Sun
      ctx.fillStyle = '#fcd34d';
      ctx.beginPath();
      ctx.arc(w - 100, 100, 60, 0, Math.PI*2);
      ctx.fill();

      // Draw Track & Ground
      ctx.beginPath();
      ctx.fillStyle = '#f5d0fe'; // Sandy/Snow mix
      
      // Draw terrain segments
      const segmentWidth = 10;
      const screenOffset = 400; // Train is at x=400
      
      ctx.moveTo(0, h);
      for (let x = 0; x < w + segmentWidth; x += segmentWidth) {
         const worldX = state.distance - screenOffset + x;
         const terrainY = h - getTerrainHeight(worldX);
         ctx.lineTo(x, terrainY);
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fill(); // Ground fill

      // Draw Rails
      ctx.strokeStyle = '#57534e';
      ctx.lineWidth = 4;
      ctx.beginPath();
      for (let x = 0; x < w + segmentWidth; x += segmentWidth) {
         const worldX = state.distance - screenOffset + x;
         const terrainY = h - getTerrainHeight(worldX) - 5;
         if (x===0) ctx.moveTo(x, terrainY);
         else ctx.lineTo(x, terrainY);
      }
      ctx.stroke();

      // Draw Train
      // Train is fixed on screen X, but Y changes with terrain
      const trainScreenX = 400;
      
      // Draw Wagons (Back to Front)
      state.wagons.forEach((wagon, i) => {
         const gap = 110;
         const myScreenX = trainScreenX - 130 - (i * gap);
         const myWorldX = state.distance - 130 - (i * gap); // Position on track curve
         const myY = h - getTerrainHeight(myWorldX) - 15;
         
         // Calculate angle of wagon based on slope
         const slopeVal = getSlope(myWorldX);
         const angle = Math.atan(slopeVal / 10); // Approx angle

         ctx.save();
         ctx.translate(myScreenX, myY);
         ctx.rotate(-angle);

         // Draw Wheels
         ctx.fillStyle = '#1f2937';
         drawWheel(ctx, 10, 10, state.distance);
         drawWheel(ctx, 70, 10, state.distance);

         // Draw Chassis
         ctx.fillStyle = '#374151';
         ctx.fillRect(0, -10, 80, 10);

         // Draw Cargo Container based on type
         const cfg = WAGON_CONFIG[wagon.type];
         ctx.fillStyle = cfg.color;
         
         if (wagon.type === 'TANK') {
            // Tank shape
            ctx.beginPath();
            ctx.roundRect(0, -45, 80, 35, 15);
            ctx.fill();
            // Liquid window
            ctx.fillStyle = '#93c5fd';
            ctx.fillRect(10, -35, 60, 15);
            // Sloshing liquid
            const level = (wagon.cargoHealth / 100) * 15;
            ctx.fillStyle = '#2563eb';
            ctx.beginPath();
            ctx.moveTo(10, -20);
            ctx.lineTo(10, -20 - level + (wagon.cargoOffset.x));
            ctx.lineTo(70, -20 - level - (wagon.cargoOffset.x));
            ctx.lineTo(70, -20);
            ctx.fill();
         } else if (wagon.type === 'BOUNCY') {
            // Cage
            ctx.strokeStyle = cfg.color;
            ctx.lineWidth = 3;
            ctx.strokeRect(0, -45, 80, 35);
            // Balls
            if (wagon.cargoHealth > 0) {
              const bounceY = wagon.cargoOffset.y;
              ctx.fillStyle = '#fca5a5'; // Light red balls
              ctx.beginPath(); ctx.arc(20, -20 + bounceY, 10, 0, Math.PI*2); ctx.fill();
              ctx.fillStyle = '#fcd34d'; // Yellow ball
              ctx.beginPath(); ctx.arc(40, -25 + bounceY, 12, 0, Math.PI*2); ctx.fill();
              ctx.fillStyle = '#86efac'; // Green ball
              ctx.beginPath(); ctx.arc(60, -20 + bounceY, 10, 0, Math.PI*2); ctx.fill();
            }
         } else if (wagon.type === 'HEAVY') {
            // Stake wagon
            ctx.fillRect(0, -15, 80, 5); // floor
            ctx.fillStyle = '#57534e'; // stakes
            ctx.fillRect(5, -45, 5, 30);
            ctx.fillRect(70, -45, 5, 30);
            // Logs
            ctx.fillStyle = '#78350f';
            ctx.beginPath(); ctx.arc(25, -25, 10, 0, Math.PI*2); ctx.fill();
            ctx.beginPath(); ctx.arc(45, -25, 10, 0, Math.PI*2); ctx.fill();
            ctx.beginPath(); ctx.arc(35, -40, 10, 0, Math.PI*2); ctx.fill();
         } else {
            // BOX
            ctx.fillRect(5, -45, 70, 35);
            ctx.fillStyle = 'rgba(0,0,0,0.2)'; // Detail line
            ctx.fillRect(5, -45, 70, 5); 
         }

         ctx.restore();
      });

      // Draw Loco (Leading)
      const locoWorldX = state.distance;
      const locoY = h - getTerrainHeight(locoWorldX) - 15;
      const locoSlope = getSlope(locoWorldX);
      const locoAngle = Math.atan(locoSlope / 10);

      ctx.save();
      ctx.translate(trainScreenX, locoY);
      ctx.rotate(-locoAngle);
      
      // Wheels
      drawWheel(ctx, 20, 10, state.distance);
      drawWheel(ctx, 50, 10, state.distance);
      drawWheel(ctx, 80, 10, state.distance);
      // Body
      ctx.fillStyle = '#dc2626'; // Red engine
      ctx.fillRect(10, -40, 90, 40);
      ctx.fillStyle = '#1f2937'; // Cab roof
      ctx.fillRect(0, -50, 40, 10);
      ctx.fillRect(0, -40, 40, 40); // Cab
      // Chimney
      ctx.fillStyle = '#111827';
      ctx.fillRect(70, -60, 20, 20);
      // Smoke
      if (state.throttle > 0 && Math.random() > 0.8) {
         state.particles.push({
           x: trainScreenX + 80,
           y: locoY - 60,
           vx: 2 + state.speed,
           vy: -2 - Math.random()*2,
           life: 60,
           color: 'rgba(255,255,255,0.5)'
         });
      }

      ctx.restore();

      // 4. PARTICLES
      for (let i = state.particles.length - 1; i >= 0; i--) {
         const p = state.particles[i];
         p.x += p.vx - (state.speed * 1); // Move with world
         p.y += p.vy;
         p.life--;
         ctx.fillStyle = p.color;
         ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI*2); ctx.fill();
         if (p.life <= 0) state.particles.splice(i, 1);
      }

      animationFrameId = requestAnimationFrame(loop);
    };

    loop();
    return () => cancelAnimationFrame(animationFrameId);
  }, [phase]);

  const drawWheel = (ctx: CanvasRenderingContext2D, x: number, y: number, dist: number) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(dist * 0.1);
    ctx.beginPath();
    ctx.arc(0, 0, 10, 0, Math.PI*2);
    ctx.fillStyle = '#1f2937';
    ctx.fill();
    ctx.strokeStyle = '#9ca3af';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(0, 10); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-10, 0); ctx.lineTo(10, 0); ctx.stroke();
    ctx.restore();
  };

  // --- RENDER UI ---

  if (phase === 'BUILD') {
    return (
      <div className="fixed inset-0 z-50 bg-slate-50 flex flex-col">
         {/* Header */}
         <div className="bg-blue-600 p-4 text-white shadow-lg flex justify-between items-center">
            <h2 className="text-xl md:text-3xl font-black uppercase">Bygg ditt godståg</h2>
            <button onClick={onComplete} className="text-white/80 hover:text-white">Avbryt ✕</button>
         </div>

         {/* Train Preview Area */}
         <div className="flex-1 bg-sky-100 relative flex flex-col justify-center items-center p-4 overflow-hidden">
            
            {/* Instructions */}
            <div className="absolute top-4 left-0 right-0 text-center">
               <div className="bg-white/80 inline-block px-6 py-2 rounded-full text-blue-900 font-bold shadow-sm">
                  Ditt lok orkar dra <span className="text-2xl text-red-600 font-black">{MAX_SLOTS}</span> vagnar!
               </div>
            </div>
            
            {/* Rails */}
            <div className="absolute bottom-1/3 w-full h-4 bg-slate-400 border-t-4 border-slate-600"></div>

            {/* The Train Lineup */}
            <div className="flex items-end gap-1 z-10 mb-[30vh] md:mb-[25vh]">
               {/* SLOTS (Rendered reversed visually so Slot 1 is behind Loco) */}
               {Array.from({ length: MAX_SLOTS }).map((_, i) => {
                  const slotIndex = MAX_SLOTS - 1 - i; // Reverse index for display
                  const wagonType = selectedWagons[slotIndex];
                  
                  return (
                    <div key={i} className="w-20 h-20 md:w-32 md:h-32 relative flex items-end justify-center group">
                       {wagonType ? (
                          <button 
                            onClick={() => removeWagon(slotIndex)}
                            className="w-full h-24 md:h-32 rounded-lg shadow-xl border-4 border-white relative hover:scale-105 transition-transform"
                            style={{ backgroundColor: WAGON_CONFIG[wagonType].color }}
                          >
                             <div className="text-4xl md:text-6xl absolute inset-0 flex items-center justify-center">{WAGON_CONFIG[wagonType].icon}</div>
                             <div className="absolute -top-3 -right-3 bg-red-500 text-white w-6 h-6 rounded-full flex items-center justify-center font-bold shadow-md">✕</div>
                          </button>
                       ) : (
                          <div className="w-full h-20 md:h-28 border-4 border-dashed border-slate-400 rounded-xl bg-slate-200/50 flex items-center justify-center text-slate-400 font-bold">
                             PLATS {slotIndex + 1}
                          </div>
                       )}
                       {/* Coupler */}
                       <div className="absolute right-[-6px] bottom-4 w-4 h-2 bg-slate-800"></div>
                    </div>
                  );
               })}
               
               {/* LOCOMOTIVE (Rightmost) */}
               <div className="w-24 h-24 md:w-40 md:h-40 relative">
                  <div className="w-full h-3/4 bg-red-600 absolute bottom-2 rounded-r-xl shadow-xl border-4 border-red-800"></div>
                  <div className="w-1/3 h-full bg-slate-800 absolute bottom-2 left-0 rounded-t-lg"></div>
                  <div className="text-4xl md:text-6xl absolute bottom-8 right-2">👨‍✈️</div>
               </div>
            </div>

            {/* Launch Button */}
            {selectedWagons.length === MAX_SLOTS && (
               <button 
                 onClick={startGame}
                 className="absolute top-1/2 mt-16 bg-green-500 hover:bg-green-600 text-white text-3xl font-black py-4 px-12 rounded-full shadow-2xl border-b-8 border-green-700 animate-bounce uppercase"
               >
                 KÖR TÅGET! ▶
               </button>
            )}
         </div>

         {/* Selection Deck */}
         <div className="bg-white border-t-4 border-slate-200 p-4 md:p-6">
            <h3 className="text-center font-bold text-slate-500 uppercase mb-4 tracking-widest">Välj vagnar från din samling</h3>
            <div className="grid grid-cols-4 gap-2 md:gap-6 max-w-4xl mx-auto">
               {(Object.keys(WAGON_CONFIG) as WagonType[]).map((type) => (
                  <button 
                    key={type}
                    onClick={() => addWagon(type)}
                    disabled={selectedWagons.length >= MAX_SLOTS}
                    className="flex flex-col items-center bg-slate-50 p-2 rounded-xl border-2 border-slate-200 hover:bg-blue-50 hover:border-blue-300 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                     <div className="text-4xl md:text-5xl mb-2">{WAGON_CONFIG[type].icon}</div>
                     <div className="font-black text-slate-700 text-xs md:text-sm">{WAGON_CONFIG[type].name}</div>
                     <div className="text-[10px] md:text-xs text-slate-500 text-center leading-tight mt-1">{WAGON_CONFIG[type].desc}</div>
                     <div className="mt-2 bg-yellow-100 text-yellow-800 text-[9px] font-bold px-2 py-0.5 rounded-full uppercase">
                        {WAGON_CONFIG[type].perk}
                     </div>
                  </button>
               ))}
            </div>
         </div>
      </div>
    );
  }

  if (phase === 'SUMMARY') {
     return (
        <div className="fixed inset-0 z-50 bg-blue-600 flex items-center justify-center p-4 animate-fade-in">
           <div className="bg-white rounded-3xl p-8 max-w-2xl w-full text-center shadow-2xl border-8 border-blue-400 relative overflow-hidden">
              <div className="absolute inset-0 bg-yellow-100/50 -rotate-12 scale-150 z-0"></div>
              <div className="relative z-10">
                 <div className="text-8xl mb-4 animate-bounce">🎉</div>
                 <h2 className="text-4xl font-black text-slate-800 mb-2 uppercase">FRAMME!</h2>
                 <p className="text-xl text-slate-600 font-bold mb-8">Vilken fantastisk leverans!</p>
                 
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
                    {gameState.current.wagons.map((w, i) => (
                       <div key={i} className="bg-white p-3 rounded-xl shadow-md border-2 border-slate-100 flex items-center gap-4 text-left">
                          <div className="text-4xl">{WAGON_CONFIG[w.type].icon}</div>
                          <div>
                             <div className="font-bold text-slate-800 text-sm">{WAGON_CONFIG[w.type].name}</div>
                             {w.cargoHealth > 80 ? (
                                <div className="text-green-600 font-bold text-xs">⭐⭐⭐ PERFEKT!</div>
                             ) : w.cargoHealth > 40 ? (
                                <div className="text-yellow-600 font-bold text-xs">⭐⭐ BRA JOBBAT</div>
                             ) : (
                                <div className="text-slate-400 font-bold text-xs">⭐ LITE SKAKIGT</div>
                             )}
                          </div>
                       </div>
                    ))}
                 </div>

                 <button 
                   onClick={onComplete}
                   className="bg-green-500 hover:bg-green-600 text-white text-2xl font-black py-4 px-12 rounded-full shadow-lg border-b-8 border-green-700 active:border-b-0 active:translate-y-2 transition-all uppercase w-full"
                 >
                    TACK FÖR TUREN!
                 </button>
              </div>
           </div>
        </div>
     );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black overflow-hidden touch-none select-none">
       <canvas ref={canvasRef} className="w-full h-full block" />
       
       {/* HUD */}
       <div className="absolute top-4 left-4 right-4 flex justify-between pointer-events-none">
          <div className="bg-white/90 backdrop-blur px-6 py-3 rounded-2xl border-4 border-slate-200 shadow-xl">
             <div className="text-xs font-bold text-slate-400 uppercase">FART</div>
             <div className="text-3xl font-black font-mono text-slate-800">{speedDisplay} <span className="text-sm text-slate-400">km/h</span></div>
          </div>
          
          <div className="bg-white/90 backdrop-blur px-6 py-3 rounded-2xl border-4 border-slate-200 shadow-xl w-1/3">
             <div className="text-xs font-bold text-slate-400 uppercase mb-1">RESA</div>
             <div className="w-full h-4 bg-slate-200 rounded-full overflow-hidden">
                <div className="h-full bg-green-500 transition-all duration-500" style={{ width: `${distanceDisplay}%` }}></div>
             </div>
          </div>
       </div>

       {/* CONTROLS */}
       <div className="absolute bottom-8 right-8 flex flex-col items-center bg-slate-900/50 p-6 rounded-3xl backdrop-blur-md border-2 border-white/20">
           <div className="text-white font-black text-xl mb-4 tracking-widest">GASA</div>
           <input 
             type="range" 
             min="0" 
             max="1" 
             step="0.01"
             defaultValue="0"
             className="h-48 w-24 accent-green-500 cursor-pointer"
             style={{ writingMode: 'vertical-lr', direction: 'rtl', appearance: 'slider-vertical' as any }}
             onChange={(e) => { gameState.current.throttle = parseFloat(e.target.value); }}
             onTouchMove={(e) => e.stopPropagation()} 
           />
       </div>
       
       {/* WAGON STATUS WARNINGS (Overlay on world) */}
       <div className="absolute top-1/2 left-0 w-full text-center pointer-events-none">
          {gameState.current.wagons.some(w => w.cargoHealth < 50) && (
             <div className="text-red-500 font-black text-4xl animate-pulse shadow-black drop-shadow-lg">
                OJ! DET SKAKAR! ⚠️
             </div>
          )}
       </div>

    </div>
  );
};