
import React, { useEffect, useRef, useState } from 'react';
import { TrainCar } from '../types';

interface TrainDeliveryGameProps {
  cars: TrainCar[]; // The full train including loco
  onComplete: () => void; // Called when all cargo is delivered
}

// --- CONFIGURATION ---
const ZOOM_SCALE = 0.5; // Makes everything smaller (Zoom out)
const SPEED = 2.5; // Slower speed (pixels per frame)
const FPS = 60;

// Timing constants (calculated in pixels based on speed)
// 1 second = 60 frames * 2.5 px = 150 pixels
const MIN_PLATFORM_DIST = 20 * 150; // 20 seconds
const MAX_PLATFORM_DIST = 45 * 150; // 45 seconds

type Biome = 'FOREST' | 'DESERT' | 'SNOW';
type SegmentType = 'NORMAL' | 'SWITCH' | 'PLATFORM';

interface TrackPoint {
  x: number;
  y: number;
  angle: number;
}

export const TrainDeliveryGame: React.FC<TrainDeliveryGameProps> = ({ cars, onComplete }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // React state for UI overlays (kept minimal for performance)
  const [cargoLeft, setCargoLeft] = useState<TrainCar[]>(cars.filter(c => c.type !== 'LOCOMOTIVE'));
  const [msg, setMsg] = useState<string>("LEVERANSEN HAR BÖRJAT!");
  const [showControls, setShowControls] = useState(false);
  const [currentBiome, setCurrentBiome] = useState<Biome>('FOREST');

  // Game Loop State (Mutable refs to avoid re-renders)
  const stateRef = useRef({
    distance: 0,
    trackPoints: [] as TrackPoint[],
    
    // Generation Logic
    nextPlatformAt: 3000, // First platform appears sooner for instant gratification
    switchesBeforePlatform: 3, 
    switchCount: 0,
    
    targetX: 0, // The X position the track is steering towards
    currentX: 0, // Current generator X
    direction: 0, // -1 (Left), 0 (Straight), 1 (Right)
    
    // Switch Logic
    pendingSwitchDistance: -1, // If > 0, a switch is approaching at this global distance
    switchDecision: null as 'LEFT' | 'RIGHT' | null,

    // Delivery Logic
    cars: [...cars], // Local copy for animation
    isDelivering: false, // Animation flag
  });

  // Initialize inputs
  const handleTurn = (direction: 'LEFT' | 'RIGHT') => {
    stateRef.current.switchDecision = direction;
    setShowControls(false); // Hide controls after pick
    setMsg(direction === 'LEFT' ? "VÄNSTER SPÅR VALT" : "HÖGER SPÅR VALT");
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Resize handling
    const updateSize = () => {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        // Initialize X center
        if (stateRef.current.distance === 0) {
            stateRef.current.currentX = canvas.width / 2;
            stateRef.current.targetX = canvas.width / 2;
        }
    };
    updateSize();
    window.addEventListener('resize', updateSize);

    let animationFrameId: number;
    
    // --- GENERATOR FUNCTIONS ---

    const generateTrack = () => {
        const state = stateRef.current;
        // Maintain a buffer of points ahead of the camera
        // Camera is at state.distance. We need points up to state.distance + height + buffer
        const lookAhead = canvas.height / ZOOM_SCALE + 1000;
        const lastPoint = state.trackPoints[state.trackPoints.length - 1] || { x: canvas.width/2, y: 0, angle: 0 };
        
        while (lastPoint.y < (state.distance + lookAhead)) {
            const nextY = lastPoint.y + 10; // Granularity
            
            // Logic for next event
            let isSwitch = false;
            let isPlatform = false;

            // 1. Check Platform Spawn
            if (nextY > state.nextPlatformAt && !state.isDelivering) {
                isPlatform = true;
                // Reset for next cycle
                const dist = MIN_PLATFORM_DIST + Math.random() * (MAX_PLATFORM_DIST - MIN_PLATFORM_DIST);
                state.nextPlatformAt = nextY + dist;
                state.switchesBeforePlatform = Math.floor(Math.random() * 3) + 2; // 2-4 switches
                state.switchCount = 0;
            }

            // 2. Check Switch Spawn
            // We place switches evenly distributed before the next platform
            const distToPlatform = state.nextPlatformAt - nextY;
            if (!isPlatform && distToPlatform > 1000 && state.switchCount < state.switchesBeforePlatform) {
                // Simple probability check based on space left
                // Or just periodic:
                const segmentSize = (state.nextPlatformAt - state.distance) / (state.switchesBeforePlatform + 1);
                // If we haven't spawned a switch recently...
                // Simplified: Just random chance if enough space
                if (Math.random() < 0.005 && !state.pendingSwitchDistance) {
                    isSwitch = true;
                    state.switchCount++;
                }
            }

            // STEERING LOGIC
            // Smoothly drift towards targetX
            // Change targetX randomly to create winding track
            if (Math.random() < 0.01) {
                const margin = 200;
                state.targetX = margin + Math.random() * (canvas.width - margin*2);
            }

            // Apply Switch Decision (Hard steer)
            if (state.pendingSwitchDistance > 0 && nextY > state.pendingSwitchDistance) {
                 // We passed the switch point. Apply the curve based on decision
                 const decision = state.switchDecision || (Math.random() > 0.5 ? 'LEFT' : 'RIGHT');
                 
                 // Force a turn
                 state.targetX = decision === 'LEFT' ? state.currentX - 300 : state.currentX + 300;
                 state.pendingSwitchDistance = -1; // Reset
                 state.switchDecision = null;
            }

            // Move currentX towards targetX
            const dx = state.targetX - state.currentX;
            state.currentX += dx * 0.005; // Smooth ease
            
            // Special handling: if it's a switch segment, we record it in the point metadata
            // but the path itself stays continuous (the "chosen" path)
            
            // Add point
            const newPoint = {
                x: state.currentX,
                y: nextY,
                angle: Math.atan2(dx * 0.005, 10),
                type: isPlatform ? 'PLATFORM' : isSwitch ? 'SWITCH' : 'NORMAL'
            };
            
            // If Switch generated, mark it for UI
            if (isSwitch) {
                state.pendingSwitchDistance = nextY;
            }

            state.trackPoints.push(newPoint as any);
            
            // Update ref for loop
            lastPoint.x = newPoint.x;
            lastPoint.y = newPoint.y;
        }

        // Prune old points
        state.trackPoints = state.trackPoints.filter(p => p.y > state.distance - 200);
    };

    // --- DRAWING FUNCTIONS ---

    const drawScenery = (ctx: CanvasRenderingContext2D) => {
        const w = canvas.width;
        const h = canvas.height;
        
        // Background
        let bg = '#86efac'; // Forest
        if (currentBiome === 'DESERT') bg = '#fde047';
        if (currentBiome === 'SNOW') bg = '#f1f5f9';
        
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, w, h);

        // Decor (Trees/Rocks)
        // We deterministically draw them based on Y coordinate
        const startY = Math.floor(stateRef.current.distance / 100) * 100;
        for (let y = startY; y < startY + (h / ZOOM_SCALE); y += 100) {
             const seed = Math.sin(y);
             // Only draw if far from track center (approx)
             // We don't have exact track X here easily without searching points, 
             // so we just draw on edges
             
             // Left side
             if (seed > 0.2) {
                 drawTree(ctx, 100 + seed * 100, y, currentBiome);
             }
             // Right side
             if (seed < -0.2) {
                 drawTree(ctx, w - 200 + seed * 100, y, currentBiome);
             }
        }
    };

    const drawTree = (ctx: CanvasRenderingContext2D, x: number, y: number, biome: Biome) => {
        // Adjust to screen space
        const screenY = (y - stateRef.current.distance);
        if (screenY < -100 || screenY > canvas.height / ZOOM_SCALE) return;

        ctx.save();
        ctx.translate(x, screenY);
        
        if (biome === 'FOREST') {
             ctx.fillStyle = '#166534';
             ctx.beginPath();
             ctx.moveTo(0, -30);
             ctx.lineTo(15, 0);
             ctx.lineTo(-15, 0);
             ctx.fill();
        } else if (biome === 'DESERT') {
             ctx.fillStyle = '#65a30d';
             ctx.fillRect(-5, -25, 10, 25);
             ctx.fillRect(5, -15, 5, 5);
        } else {
             ctx.fillStyle = '#cbd5e1';
             ctx.beginPath();
             ctx.moveTo(0, -30);
             ctx.lineTo(15, 0);
             ctx.lineTo(-15, 0);
             ctx.fill();
        }
        ctx.restore();
    };

    const render = () => {
        const state = stateRef.current;
        
        // 1. UPDATE
        if (cargoLeft.length > 0) {
             state.distance += SPEED;
        } else {
             // Stop slowly
             // state.distance += 0; 
        }
        
        generateTrack();

        // Check for Switch UI trigger
        // If a switch is coming up in X pixels
        const switchPoint = state.trackPoints.find(p => (p as any).type === 'SWITCH' && p.y > state.distance);
        if (switchPoint) {
             const dist = switchPoint.y - state.distance;
             if (dist < 800 && dist > 0) {
                 if (!showControls && !state.switchDecision) {
                     setShowControls(true);
                     setMsg("VÄXEL FRAMFÖR DIG! VÄLJ SPÅR!");
                 }
             } else {
                if (showControls) setShowControls(false);
             }
        }

        // Check for Platform Delivery Trigger
        const platformPoint = state.trackPoints.find(p => (p as any).type === 'PLATFORM' && p.y < state.distance + 100 && p.y > state.distance - 100);
        if (platformPoint && !state.isDelivering && state.cars.length > 1) {
             // Trigger delivery
             state.isDelivering = true;
             
             // Animate in React
             setTimeout(() => {
                 // Visual pop
                 const newCars = [...state.cars];
                 newCars.pop(); // Remove cargo
                 state.cars = newCars;
                 setCargoLeft(prev => prev.slice(0, -1)); // Update UI
                 setMsg("LEVERANS KLAR! BRA JOBBAT!");
                 state.isDelivering = false;
                 
                 // Change Biome
                 const biomes: Biome[] = ['FOREST', 'DESERT', 'SNOW'];
                 setCurrentBiome(biomes[Math.floor(Math.random() * biomes.length)]);

                 // CHECK WIN
                 if (newCars.length === 1) {
                     // Only loco left
                     setTimeout(onComplete, 2000);
                 }
             }, 500);
        }

        // 2. DRAW
        // Apply Zoom
        ctx.save();
        ctx.scale(ZOOM_SCALE, ZOOM_SCALE);
        
        // Draw World
        drawScenery(ctx);

        // Draw Tracks (Sleeper Layer)
        ctx.lineWidth = 24;
        ctx.strokeStyle = '#78350f'; // Wood
        ctx.lineCap = 'butt';
        ctx.beginPath();
        // Optimization: Draw segmented lines
        // We draw continuously through points
        let started = false;
        for (const p of state.trackPoints) {
            const screenY = p.y - state.distance;
            if (screenY > canvas.height/ZOOM_SCALE + 100) break;
            if (!started) { ctx.moveTo(p.x, screenY); started = true; }
            else ctx.lineTo(p.x, screenY);
            
            // Draw manual sleepers occasionally? 
            // dashed line trick is faster
        }
        ctx.setLineDash([10, 15]); // Sleepers
        ctx.stroke();
        ctx.setLineDash([]);

        // Draw Rails (Steel Layer)
        ctx.lineWidth = 4;
        ctx.strokeStyle = '#94a3b8'; // Steel
        // Left Rail
        ctx.beginPath();
        started = false;
        for (const p of state.trackPoints) {
            const screenY = p.y - state.distance;
            if (screenY > canvas.height/ZOOM_SCALE + 100) break;
            const ox = Math.cos(p.angle) * 8; // Offset
            if (!started) { ctx.moveTo(p.x - 8, screenY); started = true; }
            else ctx.lineTo(p.x - 8, screenY);
        }
        ctx.stroke();
        // Right Rail
        ctx.beginPath();
        started = false;
        for (const p of state.trackPoints) {
            const screenY = p.y - state.distance;
            if (screenY > canvas.height/ZOOM_SCALE + 100) break;
            if (!started) { ctx.moveTo(p.x + 8, screenY); started = true; }
            else ctx.lineTo(p.x + 8, screenY);
        }
        ctx.stroke();

        // Draw Switches (Visual only)
        state.trackPoints.forEach(p => {
             if ((p as any).type === 'SWITCH') {
                 const screenY = p.y - state.distance;
                 if (screenY > -100 && screenY < canvas.height/ZOOM_SCALE) {
                     // Draw a fake branching track
                     ctx.save();
                     ctx.translate(p.x, screenY);
                     ctx.strokeStyle = '#94a3b8';
                     ctx.lineWidth = 4;
                     ctx.beginPath();
                     ctx.moveTo(0,0);
                     // Draw a Y split
                     ctx.quadraticCurveTo(-20, -50, -40, -100);
                     ctx.moveTo(0,0);
                     ctx.quadraticCurveTo(20, -50, 40, -100);
                     ctx.stroke();
                     ctx.restore();
                 }
             }
        });

        // Draw Platforms
        state.trackPoints.forEach(p => {
             if ((p as any).type === 'PLATFORM') {
                 const screenY = p.y - state.distance;
                 if (screenY > -200 && screenY < canvas.height/ZOOM_SCALE) {
                     ctx.save();
                     ctx.translate(p.x + 40, screenY); // Right side of track
                     
                     // Platform Base
                     ctx.fillStyle = '#9ca3af';
                     ctx.fillRect(0, -100, 40, 200);
                     // Roof
                     ctx.fillStyle = '#ef4444';
                     ctx.beginPath();
                     ctx.moveTo(-5, -110);
                     ctx.lineTo(45, -110);
                     ctx.lineTo(45, 110);
                     ctx.lineTo(-5, 110);
                     ctx.fill();
                     
                     // Decor
                     ctx.fillStyle = '#fff';
                     ctx.font = 'bold 20px Arial';
                     ctx.fillText("STATION", -40, -120);
                     
                     ctx.restore();
                 }
             }
        });

        // 3. DRAW TRAIN
        // Train position is fixed on screen Y (bottom third), X follows the track at that Y
        // We interpolate X from trackPoints
        const trainScreenY = (canvas.height / ZOOM_SCALE) - 200;
        const trainWorldY = state.distance + trainScreenY;
        
        // Find track point at trainWorldY
        const currentPoint = state.trackPoints.find(p => p.y >= trainWorldY) || state.trackPoints[0];
        
        if (currentPoint) {
            ctx.save();
            ctx.translate(currentPoint.x, trainScreenY);
            ctx.rotate(-currentPoint.angle); // Rotate to match track
            
            drawTrain(ctx, state.cars);
            ctx.restore();
        }

        ctx.restore(); // End Zoom
        animationFrameId = requestAnimationFrame(render);
    };

    const drawTrain = (ctx: CanvasRenderingContext2D, trainCars: TrainCar[]) => {
        const carWidth = 26; // Smaller cars
        const carLength = 40;
        const gap = 5;

        // Draw backwards from Loco
        trainCars.forEach((car, index) => {
            const yOffset = index * (carLength + gap);
            
            ctx.save();
            ctx.translate(0, yOffset); // Draw down
            
            // Shadow
            ctx.fillStyle = 'rgba(0,0,0,0.3)';
            ctx.fillRect(-carWidth/2 + 2, 2, carWidth, carLength);

            // Body
            ctx.fillStyle = car.type === 'LOCOMOTIVE' ? '#e11d48' : car.color;
            if (car.type === 'COAL') ctx.fillStyle = '#1f2937';

            ctx.beginPath();
            ctx.roundRect(-carWidth/2, 0, carWidth, carLength, 4);
            ctx.fill();

            // Details
            if (car.type === 'LOCOMOTIVE') {
                ctx.fillStyle = '#fbbf24'; // Light
                ctx.fillRect(-5, 2, 10, 5);
                
                // Smoke puff
                if (Math.floor(Date.now() / 100) % 3 === 0) {
                   ctx.fillStyle = 'rgba(255,255,255,0.6)';
                   ctx.beginPath();
                   ctx.arc(0, -15, 8, 0, Math.PI*2);
                   ctx.fill();
                }
            } else {
                // Cargo box look
                ctx.fillStyle = 'rgba(255,255,255,0.3)';
                ctx.fillRect(-carWidth/2+4, 4, carWidth-8, carLength-8);
            }

            ctx.restore();
        });
    };

    render();

    return () => cancelAnimationFrame(animationFrameId);
  }, [cars, onComplete]); // Re-run only if critical props change

  return (
    <div className="fixed inset-0 z-50 bg-slate-900 flex flex-col items-center justify-center">
       <div className="relative w-full h-full bg-black overflow-hidden">
          <canvas 
            ref={canvasRef} 
            className="w-full h-full object-cover"
          />
          
          {/* HUD */}
          <div className="absolute top-4 left-0 right-0 flex justify-center pointer-events-none">
             <div className="bg-slate-900/80 text-white px-8 py-3 rounded-full border-2 border-slate-500 font-bold text-xl animate-pulse shadow-xl">
                {msg}
             </div>
          </div>

          <div className="absolute top-4 right-4 bg-blue-600 text-white p-3 rounded-xl font-black shadow-lg border-4 border-blue-400 text-sm md:text-xl">
             📦 GODS KVAR: {cargoLeft.length}
          </div>

          {/* SWITCH CONTROLS */}
          {showControls && (
             <div className="absolute bottom-10 left-0 right-0 flex justify-center gap-8 px-4 animate-bounce-in">
                 <button 
                    onClick={() => handleTurn('LEFT')}
                    className="bg-yellow-400 hover:bg-yellow-300 text-yellow-900 border-b-8 border-yellow-600 active:border-b-0 active:translate-y-2 rounded-2xl w-32 h-32 flex items-center justify-center shadow-2xl transition-all"
                 >
                    <span className="text-6xl">⬅</span>
                 </button>
                 <button 
                    onClick={() => handleTurn('RIGHT')}
                    className="bg-yellow-400 hover:bg-yellow-300 text-yellow-900 border-b-8 border-yellow-600 active:border-b-0 active:translate-y-2 rounded-2xl w-32 h-32 flex items-center justify-center shadow-2xl transition-all"
                 >
                    <span className="text-6xl">➡</span>
                 </button>
             </div>
          )}
       </div>
    </div>
  );
};
