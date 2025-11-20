import React, { useEffect, useRef, useState } from 'react';
import { TrainCar } from '../types';
import { TrainViz } from './TrainViz';

interface TrainDeliveryGameProps {
  cars: TrainCar[];
  onComplete: () => void;
}

export const TrainDeliveryGame: React.FC<TrainDeliveryGameProps> = ({ cars, onComplete }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // Game State
  const [localCars, setLocalCars] = useState<TrainCar[]>([...cars]);
  const [gameSpeed, setGameSpeed] = useState(2); // 0 to 10
  const [distance, setDistance] = useState(0);
  const [msg, setMsg] = useState("KÖR TILL NÄSTA STATION!");
  const [showSwitchControls, setShowSwitchControls] = useState(false);
  const [cargoAnimation, setCargoAnimation] = useState<{active: boolean, x: number, y: number}>({ active: false, x: 0, y: 0 });

  // Constants
  const GROUND_HEIGHT = 100;
  const PLATFORM_INTERVAL = 3000; // pixels
  const SWITCH_INTERVAL = 1500; // pixels

  // Refs for loop
  const stateRef = useRef({
    distance: 0,
    lastPlatformDist: 0,
    lastSwitchDist: 0,
    nextEntity: 'SWITCH', // 'SWITCH' or 'PLATFORM'
    snowflakes: [] as {x: number, y: number, r: number, v: number}[],
    entities: [] as {type: 'PLATFORM' | 'SWITCH' | 'TREE', x: number, id: number}[],
    trackOffset: 0,
    isSwitching: false,
    switchDirection: 'STRAIGHT' as 'STRAIGHT' | 'UP' | 'DOWN'
  });

  // Init Snow
  useEffect(() => {
    stateRef.current.snowflakes = Array.from({ length: 100 }).map(() => ({
        x: Math.random() * window.innerWidth,
        y: Math.random() * window.innerHeight,
        r: Math.random() * 3 + 1,
        v: Math.random() * 2 + 1
    }));
  }, []);

  const handleSwitch = (dir: 'UP' | 'DOWN') => {
      stateRef.current.switchDirection = dir;
      setMsg(dir === 'UP' ? "BYTER TILL ÖVRE SPÅRET" : "BYTER TILL UNDRE SPÅRET");
      setShowSwitchControls(false);
      // Visual bump effect
      stateRef.current.isSwitching = true;
      setTimeout(() => { stateRef.current.isSwitching = false; }, 1000);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let frameId: number;

    const render = () => {
        if (!canvas) return;
        // Resize
        if (canvas.width !== window.innerWidth) canvas.width = window.innerWidth;
        if (canvas.height !== window.innerHeight) canvas.height = window.innerHeight;
        
        const w = canvas.width;
        const h = canvas.height;
        const state = stateRef.current;

        // UPDATE LOGIC
        state.distance += gameSpeed;
        state.trackOffset = (state.trackOffset + gameSpeed) % 100; // For rail sleepers animation

        // Spawn Entities
        const spawnEdge = w + 100;
        
        // Trees / Props
        if (Math.random() < 0.01) {
            state.entities.push({ type: 'TREE', x: spawnEdge, id: Math.random() });
        }

        // Switches & Platforms
        if (state.distance > state.lastSwitchDist + SWITCH_INTERVAL && state.nextEntity === 'SWITCH') {
             state.entities.push({ type: 'SWITCH', x: spawnEdge, id: Date.now() });
             state.lastSwitchDist = state.distance;
             state.nextEntity = 'PLATFORM';
        }
        
        if (state.distance > state.lastPlatformDist + PLATFORM_INTERVAL && state.nextEntity === 'PLATFORM') {
             state.entities.push({ type: 'PLATFORM', x: spawnEdge, id: Date.now() });
             state.lastPlatformDist = state.distance;
             state.nextEntity = 'SWITCH';
        }

        // Move Entities
        state.entities.forEach(e => e.x -= gameSpeed);
        state.entities = state.entities.filter(e => e.x > -500); // Cleanup

        // CHECK EVENTS
        // 1. Switch controls
        const approachingSwitch = state.entities.find(e => e.type === 'SWITCH' && e.x > w/2 && e.x < w/2 + 400);
        if (approachingSwitch && !showSwitchControls) {
            // We interact via React state, so check external flag if we shouldn't update state in loop constantly
            // Here we assume if 'showSwitchControls' is false, we trigger it.
            // But since we are in a ref loop, we can't read the latest react state easily without a ref.
            // Simplified: UI handles the display based on distance logic below in the component return, 
            // or we just trigger a message.
        }

        // 2. Platform Delivery
        // Train is approx at x = w/2. 
        // Platform center is e.x + width/2.
        const trainHeadX = w / 2 + 100; // TrainViz is centered-ish
        const activePlatform = state.entities.find(e => e.type === 'PLATFORM' && Math.abs(e.x - (w/2 - 100)) < 10); // precise hit
        
        if (activePlatform) {
             // Only deliver if we have cargo
             if (localCars.length > 1 && gameSpeed > 0) {
                 // Slow down effect
                 // Trigger React side effect
                 handlePlatformHit(activePlatform.x, h - GROUND_HEIGHT - 50);
             }
        }

        // DRAWING
        // 1. SKY
        const grad = ctx.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, '#3b82f6'); // Blue sky
        grad.addColorStop(1, '#dbeafe'); // Lighter bottom
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);

        // 2. MOUNTAINS (Parallax)
        // Draw 3 layers of mountains moving at different speeds
        drawMountains(ctx, w, h, state.distance * 0.1, '#e2e8f0', 300); // Back
        drawMountains(ctx, w, h, state.distance * 0.2, '#cbd5e1', 200); // Mid
        drawMountains(ctx, w, h, state.distance * 0.5, '#94a3b8', 100); // Front

        // 3. GROUND & TRACK
        const groundY = h - GROUND_HEIGHT;
        
        // Ground fill
        ctx.fillStyle = '#fffbeb'; // Snowish/Sand mix
        ctx.fillRect(0, groundY, w, GROUND_HEIGHT);
        
        // Rails
        ctx.strokeStyle = '#78350f'; // Wood sleepers
        ctx.lineWidth = 8;
        const sleeperSpacing = 40;
        const sleeperOffset = state.distance % sleeperSpacing;
        
        ctx.beginPath();
        for(let lx = -sleeperOffset; lx < w; lx += sleeperSpacing) {
            ctx.moveTo(lx, groundY - 15);
            ctx.lineTo(lx, groundY + 15);
        }
        ctx.stroke();

        // Steel Rails
        ctx.strokeStyle = '#64748b'; // Steel
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(0, groundY - 10);
        ctx.lineTo(w, groundY - 10);
        ctx.moveTo(0, groundY + 10);
        ctx.lineTo(w, groundY + 10);
        ctx.stroke();

        // 4. ENTITIES
        state.entities.forEach(e => {
            if (e.type === 'TREE') {
                drawTree(ctx, e.x, groundY - 20);
            } else if (e.type === 'SWITCH') {
                drawSwitch(ctx, e.x, groundY - 20);
            } else if (e.type === 'PLATFORM') {
                drawPlatform(ctx, e.x, groundY - 20);
            }
        });

        // 5. SNOW
        ctx.fillStyle = '#ffffff';
        state.snowflakes.forEach(flake => {
            flake.y += flake.v;
            flake.x -= gameSpeed * 0.5; // Wind
            if (flake.y > h) flake.y = -10;
            if (flake.x < -10) flake.x = w + 10;
            
            ctx.beginPath();
            ctx.arc(flake.x, flake.y, flake.r, 0, Math.PI*2);
            ctx.fill();
        });

        frameId = requestAnimationFrame(render);
    };

    const drawMountains = (ctx: CanvasRenderingContext2D, w: number, h: number, offset: number, color: string, height: number) => {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(0, h);
        
        const peakWidth = 300;
        // Generate peaks based on sin waves to look infinite
        for(let x = - (offset % peakWidth); x < w + peakWidth; x += peakWidth/2) {
             // deterministic pseudo random height
             const noise = Math.sin((x + offset) * 0.01) * 50;
             ctx.lineTo(x, h - GROUND_HEIGHT - height + noise);
             ctx.lineTo(x + peakWidth/4, h - GROUND_HEIGHT - height/2);
        }
        
        ctx.lineTo(w, h);
        ctx.fill();
        
        // Snow caps
        ctx.fillStyle = 'white';
        // Simple overlay for snow caps (triangles at peaks)
    };

    const drawTree = (ctx: CanvasRenderingContext2D, x: number, y: number) => {
        ctx.fillStyle = '#1e293b'; // Dark trunk
        ctx.fillRect(x-5, y-20, 10, 20);
        ctx.fillStyle = '#0f766e'; // Pine green
        ctx.beginPath();
        ctx.moveTo(x-25, y-20);
        ctx.lineTo(x, y-80);
        ctx.lineTo(x+25, y-20);
        ctx.fill();
        // Snow on tree
        ctx.fillStyle = 'white';
        ctx.beginPath();
        ctx.moveTo(x-10, y-60);
        ctx.lineTo(x, y-80);
        ctx.lineTo(x+10, y-60);
        ctx.fill();
    };

    const drawSwitch = (ctx: CanvasRenderingContext2D, x: number, y: number) => {
        ctx.fillStyle = '#333';
        ctx.fillRect(x, y - 40, 10, 40); // Pole
        ctx.fillStyle = '#ef4444'; // Signal Light Red
        ctx.beginPath();
        ctx.arc(x+5, y-45, 8, 0, Math.PI*2);
        ctx.fill();
        
        // Track fork visual on ground
        ctx.strokeStyle = '#64748b';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(x - 50, y + 10);
        ctx.lineTo(x + 50, y - 20); // Fork up
        ctx.stroke();
    };

    const drawPlatform = (ctx: CanvasRenderingContext2D, x: number, y: number) => {
        // Platform base
        ctx.fillStyle = '#9ca3af';
        ctx.fillRect(x, y, 200, 20);
        
        // Roof Pillars
        ctx.fillStyle = '#4b5563';
        ctx.fillRect(x + 20, y - 80, 10, 80);
        ctx.fillRect(x + 170, y - 80, 10, 80);
        
        // Roof
        ctx.fillStyle = '#b91c1c';
        ctx.beginPath();
        ctx.moveTo(x + 10, y - 80);
        ctx.lineTo(x + 100, y - 110);
        ctx.lineTo(x + 190, y - 80);
        ctx.fill();

        // Sign
        ctx.fillStyle = '#fef3c7';
        ctx.fillRect(x + 80, y - 60, 40, 20);
        ctx.font = '10px Arial';
        ctx.fillStyle = 'black';
        ctx.fillText("STN", x+90, y-45);
    };
    
    render();
    return () => cancelAnimationFrame(frameId);
  }, [localCars, gameSpeed]); // Dependencies for render loop init

  // EXTERNAL REACT LOGIC
  
  const handlePlatformHit = (platformX: number, platformY: number) => {
      // Debounce logic handled by stateRef logic in loop usually, but we need to be careful here.
      // To simplify: We just remove the car.
      
      // We assume this is called ONCE per platform pass due to the precise hit check in loop
      setLocalCars(prev => {
          if (prev.length <= 1) return prev;
          
          // Animate Cargo
          setCargoAnimation({
              active: true,
              x: window.innerWidth / 2 + 100, // Train tail approx
              y: window.innerHeight - 200
          });
          setTimeout(() => setCargoAnimation(prev => ({...prev, active: false})), 1000);

          const newCars = prev.slice(0, -1);
          setMsg("LEVERANS KLAR! BRA JOBBAT!");
          
          // Win Condition
          if (newCars.length === 1) {
             setGameSpeed(0);
             setMsg("UPPDRAG SLUTFÖRT!");
             setTimeout(onComplete, 3000);
          }
          return newCars;
      });
  };

  // Check for Switch UI visibility based on distance (Polling effect)
  // Since the canvas loop runs outside React state, we can use a simpler timer for UI updates
  useEffect(() => {
      const interval = setInterval(() => {
           const state = stateRef.current;
           const approachingSwitch = state.entities.find(e => e.type === 'SWITCH' && e.x > window.innerWidth/2 && e.x < window.innerWidth - 200);
           
           if (approachingSwitch) {
               setShowSwitchControls(true);
           } else {
               setShowSwitchControls(false);
           }
      }, 200);
      return () => clearInterval(interval);
  }, []);

  return (
    <div className="fixed inset-0 z-50 bg-slate-900 text-white overflow-hidden">
      <canvas ref={canvasRef} className="block w-full h-full" />
      
      {/* TRAIN OVERLAY */}
      {/* We position the TrainViz fixed in the center-ish */}
      <div className="absolute bottom-[100px] left-0 right-0 flex justify-center pointer-events-none">
          {/* Container width determines train alignment. We want locomotive near center */}
          <div className="w-[800px] relative transform translate-x-32"> 
              <TrainViz cars={localCars} hideTrack={true} />
          </div>
      </div>
      
      {/* Cargo Animation */}
      {cargoAnimation.active && (
          <div 
            className="absolute text-6xl transition-all duration-1000 ease-out z-50"
            style={{ 
                left: cargoAnimation.x, 
                top: cargoAnimation.y,
                transform: 'translate(200px, -200px) rotate(360deg) scale(0.5)',
                opacity: 0
            }}
          >
             📦
          </div>
      )}

      {/* UI CONTROLS */}
      <div className="absolute top-4 left-0 right-0 flex justify-center pointer-events-none">
        <div className="bg-slate-800/90 backdrop-blur px-8 py-3 rounded-2xl border-4 border-slate-600 shadow-2xl text-center">
            <div className="text-xs text-slate-400 uppercase tracking-widest mb-1">MEDDELANDE</div>
            <div className="text-2xl font-black text-yellow-400 animate-pulse">{msg}</div>
        </div>
      </div>

      {/* SPEED CONTROL (Bottom Left) */}
      <div className="absolute bottom-8 left-8 flex flex-col items-center bg-slate-800/80 p-4 rounded-2xl border-2 border-slate-600">
           <div className="text-xs font-bold mb-2 uppercase text-slate-300">Hastighet</div>
           <input 
             type="range" 
             min="0" 
             max="10" 
             value={gameSpeed} 
             onChange={(e) => setGameSpeed(Number(e.target.value))}
             className="h-32 w-12 appearance-none bg-slate-600 rounded-full outline-none slider-vertical"
             style={{ writingMode: 'vertical-lr', direction: 'rtl' }}
           />
           <div className="mt-2 font-mono text-xl font-bold">{gameSpeed}</div>
      </div>

      {/* SWITCH CONTROLS (Right Side) */}
      {showSwitchControls && (
          <div className="absolute bottom-32 right-8 flex flex-col gap-4 animate-bounce-in">
               <div className="text-center bg-red-600 text-white font-black px-2 py-1 rounded uppercase text-sm mb-1 animate-pulse">Växel!</div>
               <button 
                  onClick={() => handleSwitch('UP')}
                  className="w-24 h-24 bg-yellow-400 hover:bg-yellow-300 rounded-xl border-b-8 border-yellow-600 active:border-b-0 active:translate-y-2 shadow-xl flex flex-col items-center justify-center group"
               >
                  <span className="text-4xl group-hover:-translate-y-1 transition-transform">⬆️</span>
                  <span className="text-xs font-black text-yellow-900 mt-1">ÖVRE</span>
               </button>
               <button 
                  onClick={() => handleSwitch('DOWN')}
                  className="w-24 h-24 bg-yellow-400 hover:bg-yellow-300 rounded-xl border-b-8 border-yellow-600 active:border-b-0 active:translate-y-2 shadow-xl flex flex-col items-center justify-center group"
               >
                  <span className="text-4xl group-hover:translate-y-1 transition-transform">⬇️</span>
                   <span className="text-xs font-black text-yellow-900 mt-1">UNDRE</span>
               </button>
          </div>
      )}

      {/* Exit Button */}
      <button 
        onClick={onComplete}
        className="absolute top-4 left-4 bg-red-500 hover:bg-red-600 text-white p-3 rounded-full shadow-lg font-bold"
      >
        ✕ AVSLUTA
      </button>
    </div>
  );
};