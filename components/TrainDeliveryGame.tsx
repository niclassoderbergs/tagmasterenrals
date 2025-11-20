
import React, { useEffect, useRef, useState } from 'react';
import { TrainCar } from '../types';

interface TrainDeliveryGameProps {
  cars: TrainCar[]; // The full train including loco
  onComplete: () => void; // Called when all cargo is delivered
}

// Game Constants
const SPEED = 3;
const STATION_INTERVAL = 800; // Pixels between station opportunities
const SWITCH_zone = 200; // How far before station the switch appears

type Biome = 'FOREST' | 'DESERT' | 'SNOW';

export const TrainDeliveryGame: React.FC<TrainDeliveryGameProps> = ({ cars, onComplete }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [cargoLeft, setCargoLeft] = useState<TrainCar[]>(cars.filter(c => c.type !== 'LOCOMOTIVE'));
  const [msg, setMsg] = useState<string>("KÖR TILL STATIONEN!");
  const [switchActive, setSwitchActive] = useState(false); // Is the switch turned to the station?
  const [showSwitchButton, setShowSwitchButton] = useState(false);
  
  // Game State Refs (for loop)
  const stateRef = useRef({
    distance: 0,
    nextStationAt: STATION_INTERVAL,
    isDocking: false,
    dockingProgress: 0,
    trackOffset: 0, // For scrolling texture
    biome: 'FOREST' as Biome,
    trainLaneX: 0, // 0 = center, 100 = station siding
    cars: cars, // Local copy for rendering
  });

  // Handle Switch Click
  const toggleSwitch = () => {
    setSwitchActive(!switchActive);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;

    // Assets generators
    const drawTree = (ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, biome: Biome) => {
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(scale, scale);
        
        if (biome === 'FOREST') {
            // Pine Tree
            ctx.fillStyle = '#4ade80'; // bright green
            ctx.beginPath();
            ctx.moveTo(0, -40);
            ctx.lineTo(20, 0);
            ctx.lineTo(-20, 0);
            ctx.fill();
            ctx.fillStyle = '#16a34a'; // darker
            ctx.beginPath();
            ctx.moveTo(0, -25);
            ctx.lineTo(25, 15);
            ctx.lineTo(-25, 15);
            ctx.fill();
            // Trunk
            ctx.fillStyle = '#78350f';
            ctx.fillRect(-5, 15, 10, 10);
        } else if (biome === 'DESERT') {
            // Cactus
            ctx.fillStyle = '#65a30d';
            ctx.beginPath();
            ctx.roundRect(-10, -40, 20, 50, 10);
            ctx.fill();
            ctx.beginPath();
            ctx.roundRect(10, -20, 15, 10, 5); // arm right
            ctx.fill();
            ctx.beginPath();
            ctx.roundRect(20, -30, 10, 20, 5); // arm right up
            ctx.fill();
        } else {
             // Snow Tree
            ctx.fillStyle = '#e0f2fe'; // whiteish
            ctx.beginPath();
            ctx.moveTo(0, -40);
            ctx.lineTo(20, 0);
            ctx.lineTo(-20, 0);
            ctx.fill();
            ctx.fillStyle = '#cbd5e1'; // darker
            ctx.beginPath();
            ctx.moveTo(0, -25);
            ctx.lineTo(25, 15);
            ctx.lineTo(-25, 15);
            ctx.fill();
            ctx.fillStyle = '#475569';
            ctx.fillRect(-5, 15, 10, 10);
        }
        ctx.restore();
    };

    const drawTrain = (ctx: CanvasRenderingContext2D, centerX: number, trainCars: TrainCar[]) => {
        const carWidth = 40;
        const carLength = 60;
        const gap = 10;
        // Draw from bottom (loco) to top
        // Loco is at fixed screen position Y
        const screenY = canvas.height - 150;

        trainCars.forEach((car, index) => {
            const yPos = screenY + (index * (carLength + gap));
            
            // Don't draw if off screen
            if (yPos > canvas.height + 100) return;

            ctx.save();
            ctx.translate(centerX, yPos);
            
            // Shadow
            ctx.fillStyle = 'rgba(0,0,0,0.3)';
            ctx.fillRect(-carWidth/2 + 5, 5, carWidth, carLength);

            // Body
            ctx.fillStyle = car.type === 'LOCOMOTIVE' ? '#e11d48' : car.color;
            if (car.type === 'COAL') ctx.fillStyle = '#1f2937';
            
            ctx.beginPath();
            ctx.roundRect(-carWidth/2, 0, carWidth, carLength, 8);
            ctx.fill();

            // Details
            ctx.fillStyle = 'rgba(255,255,255,0.3)';
            ctx.fillRect(-carWidth/2 + 5, 10, carWidth - 10, carLength - 20);

            if (car.type === 'LOCOMOTIVE') {
                // Smoke
                ctx.fillStyle = '#ccc';
                ctx.beginPath();
                ctx.arc(0, 10, 5, 0, Math.PI * 2);
                ctx.fill();
                // Funnel
                ctx.fillStyle = '#333';
                ctx.beginPath();
                ctx.arc(0, 30, 8, 0, Math.PI * 2);
                ctx.fill();
            }

            ctx.restore();
        });
    };

    const render = () => {
        const state = stateRef.current;
        const w = canvas.width;
        const h = canvas.height;

        // 1. UPDATE LOGIC
        if (!state.isDocking) {
            state.distance += SPEED;
            state.trackOffset = (state.trackOffset + SPEED) % 100; // For track sleeper animation
        } else {
            // Docking animation logic
            state.dockingProgress += 0.01;
            if (state.dockingProgress > 1) {
                // DOCKED & DELIVERED
                state.isDocking = false;
                state.dockingProgress = 0;
                state.distance += SPEED; // Start moving again
                
                // Remove last car logic handled in React Effect via callback, but for visual immediate update:
                const newCars = [...state.cars];
                if (newCars.length > 1) {
                    newCars.pop(); // Remove last car
                    state.cars = newCars;
                    // Trigger React update
                    setCargoLeft(prev => prev.slice(0, -1));
                    setMsg("BRA! EN VAGN LEVERERAD!");
                    
                    // Change biome for variety
                    const biomes: Biome[] = ['FOREST', 'DESERT', 'SNOW'];
                    state.biome = biomes[Math.floor(Math.random() * biomes.length)];
                    
                    // Reset switch
                    setSwitchActive(false);

                    // Check win condition
                    if (newCars.length === 1) { // Only loco left
                        setTimeout(onComplete, 1000);
                    }
                }
            }
        }

        // Calculate relative positions
        const distToStation = state.nextStationAt - state.distance;
        
        // Show/Hide Switch UI
        const switchVisible = distToStation < 800 && distToStation > 100;
        if (switchVisible !== showSwitchButton) setShowSwitchButton(switchVisible);

        // Lane Logic (Animation)
        let targetX = w / 2;
        // Logic: If we are in the "Switch Zone" (dist 400 to 0) AND switch is active, move train to side
        if (switchActive && distToStation < 400 && distToStation > -200) {
             targetX = (w / 2) + 60; // Move right
        }
        // Smooth lane transition
        state.trainLaneX = state.trainLaneX + (targetX - state.trainLaneX) * 0.1;


        // DOCKING TRIGGER
        if (switchActive && distToStation < 50 && distToStation > -50 && !state.isDocking) {
             state.isDocking = true;
             setMsg("LASTAR AV...");
             // Reset station timer for next one
             state.nextStationAt = state.distance + STATION_INTERVAL + 500; 
        } else if (!switchActive && distToStation < -100) {
             // Missed it
             if (state.nextStationAt < state.distance) {
                 state.nextStationAt = state.distance + STATION_INTERVAL;
                 setMsg("MISSADE STATIONEN! KÖR TILL NÄSTA.");
                 setSwitchActive(false);
             }
        }


        // 2. DRAW BACKGROUND
        ctx.fillStyle = state.biome === 'FOREST' ? '#86efac' : state.biome === 'DESERT' ? '#fde047' : '#f1f5f9';
        ctx.fillRect(0, 0, w, h);

        // DRAW SCENERY (Based on Scroll Position)
        // We pseudo-randomly place items based on Y coordinate
        const scenerySeed = Math.floor(state.distance / 100);
        for (let i = -1; i < 10; i++) {
             const zoneY = (scenerySeed + i) * 100;
             const screenY = h - (zoneY - state.distance);
             
             // Left side
             if ((zoneY * 13) % 7 < 3) {
                 drawTree(ctx, 40, screenY, 0.8, state.biome);
             }
             // Right side
             if ((zoneY * 17) % 5 < 2) {
                 drawTree(ctx, w - 40, screenY, 0.8, state.biome);
             }
        }


        // 3. DRAW TRACKS
        const trackCenterX = w / 2;
        const sidingCenterX = (w / 2) + 60;

        ctx.lineWidth = 40;
        ctx.lineCap = 'butt';
        
        // Sleeper function
        const drawSleepers = (centerX: number, offsetY: number) => {
            ctx.beginPath();
            ctx.strokeStyle = '#78350f'; // wood
            ctx.lineWidth = 8;
            for (let i = -2; i < h/20 + 2; i++) {
                 const y = (i * 40) + offsetY;
                 ctx.moveTo(centerX - 25, y);
                 ctx.lineTo(centerX + 25, y);
            }
            ctx.stroke();
        };

        // Rails function
        const drawRails = (centerX: number) => {
            ctx.strokeStyle = '#cbd5e1'; // steel
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.moveTo(centerX - 15, 0);
            ctx.lineTo(centerX - 15, h);
            ctx.moveTo(centerX + 15, 0);
            ctx.lineTo(centerX + 15, h);
            ctx.stroke();
        };

        // Draw Main Track
        drawSleepers(trackCenterX, state.trackOffset % 40);
        drawRails(trackCenterX);

        // Draw Siding Track (if visible)
        if (distToStation < 900 && distToStation > -500) {
            const sidingYStart = h - (state.nextStationAt - state.distance); // This moves DOWN the screen
            
            ctx.save();
            // Siding geometry is tricky in 2D scrolling without complex math. 
            // Simplified: We just draw a parallel track that fades in/out or connects diagonally
            
            // Calculate connection points based on distToStation
            // Start split at 600, fully split at 400
            
            // Visual hack: Draw siding track fixed relative to the "Station" object moving down
            const stationScreenY = h - (state.nextStationAt - state.distance);
            
            // The siding track
            ctx.translate(0, stationScreenY);
            
            // Parallel part at station
            ctx.beginPath();
            ctx.strokeStyle = '#78350f'; // wood
            ctx.lineWidth = 8;
            // Draw sleepers for siding
            for(let i=0; i<15; i++) {
               ctx.moveTo(sidingCenterX - 25, i*30);
               ctx.lineTo(sidingCenterX + 25, i*30);
            }
            ctx.stroke();
            
            // Rails for siding
            ctx.strokeStyle = '#94a3b8';
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.moveTo(sidingCenterX-15, -200); // Connect from back
            ctx.lineTo(sidingCenterX-15, 500);
            ctx.moveTo(sidingCenterX+15, -200);
            ctx.lineTo(sidingCenterX+15, 500);
            ctx.stroke();

            // Switch / Connection track (Diagonal)
            // Drawn roughly before the station
            ctx.beginPath();
            ctx.moveTo(trackCenterX, 400); 
            ctx.lineTo(sidingCenterX, 200);
            // This is hard to animate perfectly scrolling without a camera system.
            // Let's rely on the train movement to sell the effect.
            
            // Draw Platform
            ctx.fillStyle = '#9ca3af'; // concrete
            ctx.fillRect(sidingCenterX + 25, 0, 40, 400);
            // Roof
            ctx.fillStyle = '#ef4444';
            ctx.fillRect(sidingCenterX + 30, 10, 30, 380);
            
            ctx.restore();
        }

        // 4. DRAW TRAIN
        drawTrain(ctx, state.trainLaneX, state.cars);

        animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
        cancelAnimationFrame(animationFrameId);
    };
  }, [cars, switchActive, showSwitchButton, onComplete]);

  return (
    <div className="fixed inset-0 z-50 bg-slate-900 flex flex-col items-center justify-center">
       <div className="relative w-full max-w-md h-full max-h-[800px] bg-black overflow-hidden shadow-2xl rounded-xl border-4 border-slate-700">
          <canvas 
            ref={canvasRef} 
            width={360} 
            height={640} 
            className="w-full h-full object-cover"
          />
          
          {/* HUD */}
          <div className="absolute top-4 left-0 right-0 flex justify-center">
             <div className="bg-slate-900/80 text-white px-6 py-2 rounded-full border border-slate-500 font-bold animate-pulse">
                {msg}
             </div>
          </div>

          <div className="absolute top-16 right-4 bg-blue-600 text-white p-2 rounded-lg font-bold shadow-lg border-2 border-blue-400 text-xs">
             GODS KVAR: {cargoLeft.length}
          </div>

          {/* CONTROLS */}
          {showSwitchButton && (
             <div className="absolute bottom-20 left-0 right-0 flex justify-center px-4">
                 <button 
                   onClick={toggleSwitch}
                   className={`
                      w-full py-6 rounded-2xl font-black text-3xl shadow-xl border-b-8 active:border-b-0 active:translate-y-2 transition-all
                      flex flex-col items-center gap-2
                      ${switchActive 
                        ? 'bg-green-500 border-green-700 text-white' 
                        : 'bg-yellow-400 border-yellow-600 text-yellow-900'
                      }
                   `}
                 >
                    <span className="text-5xl">{switchActive ? '⬆ RAKT FRAM' : '➡ VÄXLA TILL STATION'}</span>
                    <span className="text-sm opacity-80 uppercase">{switchActive ? 'Tåget stannar' : 'Tryck för att svänga'}</span>
                 </button>
             </div>
          )}
       </div>
    </div>
  );
};
