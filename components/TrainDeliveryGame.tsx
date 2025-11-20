
import React, { useEffect, useRef, useState } from 'react';
import { TrainCar } from '../types';

interface TrainDeliveryGameProps {
  cars: TrainCar[];
  onComplete: () => void;
}

// --- CONFIGURATION ---
const ZOOM = 0.5;
const SPEED = 4; // World units per frame
const FPS = 60;
// 1 second = 60 frames * 4 units = 240 units.
// 20 seconds = 4800 units.
// 45 seconds = 10800 units.
const MIN_PLATFORM_DIST = 4800; 
const MAX_PLATFORM_DIST = 10800;
const SWITCH_LOOKAHEAD = 1500; // Show arrows when switch is this close
const TRACK_WIDTH = 60;

type Biome = 'FOREST' | 'DESERT' | 'SNOW';
type TrackType = 'NORMAL' | 'SWITCH' | 'PLATFORM';

interface TrackPoint {
  x: number;
  y: number;
  angle: number;
  type: TrackType;
  width: number;
  isBranch?: boolean; // If true, this is a visual decoy branch
  platformSide?: 'LEFT' | 'RIGHT';
}

interface GameState {
  // Position (We move upwards, so Y decreases)
  cameraY: number;
  
  // Track Generation
  points: TrackPoint[];
  lastGenY: number;
  lastGenX: number;
  lastGenAngle: number;
  
  // Events
  nextPlatformY: number;
  nextSwitchY: number;
  switchesBeforePlatform: number;
  switchCount: number;
  
  // Logic
  activeDecision: 'LEFT' | 'RIGHT' | null; // User input
  lockedDecision: 'LEFT' | 'RIGHT' | null; // Locked when entering switch
  
  // Delivery
  cars: TrainCar[]; // Mutable copy
  deliveredCount: 0;
  lastPlatformTime: number;
  
  // Visuals
  biome: Biome;
  particles: {x: number, y: number, vx: number, vy: number, life: number, color: string}[];
}

export const TrainDeliveryGame: React.FC<TrainDeliveryGameProps> = ({ cars, onComplete }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // React State for UI
  const [showArrows, setShowArrows] = useState(false);
  const [msg, setMsg] = useState("LEVERANS PÅGÅR...");
  const [cargoLeft, setCargoLeft] = useState(0);
  
  // Game State Ref
  const state = useRef<GameState>({
    cameraY: 0,
    points: [],
    lastGenY: 0,
    lastGenX: 0, 
    lastGenAngle: -Math.PI / 2, // Facing UP
    
    nextPlatformY: -MIN_PLATFORM_DIST,
    nextSwitchY: -1000, // First switch soon
    switchesBeforePlatform: 2,
    switchCount: 0,
    
    activeDecision: null,
    lockedDecision: null,
    
    cars: [],
    deliveredCount: 0,
    lastPlatformTime: 0,
    
    biome: 'FOREST',
    particles: []
  });

  // Handle Input
  const handleTurn = (dir: 'LEFT' | 'RIGHT') => {
    state.current.activeDecision = dir;
    // Visual feedback could be added here
  };

  useEffect(() => {
    const s = state.current;
    s.cars = JSON.parse(JSON.stringify(cars)); // Deep copy
    s.lastGenX = window.innerWidth; // Start center-ish (in scaled coords, managed in loop)
    setCargoLeft(s.cars.filter(c => c.type !== 'LOCOMOTIVE').length);

    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let frameId: number;

    // --- HELPER: ADD POINT ---
    const addPoint = (x: number, y: number, angle: number, type: TrackType = 'NORMAL', extra: Partial<TrackPoint> = {}) => {
       s.points.push({ x, y, angle, type, width: TRACK_WIDTH, ...extra });
    };

    // --- GENERATION LOGIC ---
    const generateTrack = () => {
        // Generate ahead of camera
        // Camera Y goes negative (UP). So we generate if lastGenY > cameraY - 2000
        // (Since negative numbers: -500 > -2000 is true. We want to generate if lastGenY is NOT far enough ahead)
        // i.e. lastGenY needs to be MORE negative than cameraY - screenHeight
        
        const lookAhead = (canvas.height / ZOOM) + 1000;
        const targetY = s.cameraY - lookAhead;

        while (s.lastGenY > targetY) {
            const step = 20; // Resolution
            const nextY = s.lastGenY - step;
            
            // 1. CHECK SWITCH
            // We define a "Switch Zone" around nextSwitchY
            const distToSwitch = Math.abs(s.lastGenY - s.nextSwitchY);
            
            if (distToSwitch < step && s.switchCount < s.switchesBeforePlatform) {
                // START OF SWITCH
                // Based on lockedDecision (or random), curve Main one way, Branch other way
                const decision = s.lockedDecision || (Math.random() > 0.5 ? 'LEFT' : 'RIGHT');
                
                // Main Track logic updates lastGenX/Angle
                const turnRate = 0.05;
                const mainAngle = s.lastGenAngle + (decision === 'LEFT' ? -turnRate : turnRate);
                
                const nextX = s.lastGenX + Math.cos(mainAngle) * step;
                
                // Add Main Point
                addPoint(nextX, nextY, mainAngle, 'SWITCH');
                
                // Add Decoy Branch Points (Visual only, just one frame of data or a few?)
                // We just add a "branch" marker to the point, renderer handles drawing the decoy fork
                s.points[s.points.length-1].isBranch = true;
                
                // Update State
                s.lastGenX = nextX;
                s.lastGenAngle = mainAngle;
                s.lastGenY = nextY;

                // Schedule next switch
                s.switchCount++;
                // Distribute switches
                const distRemaining = Math.abs(nextY - s.nextPlatformY);
                const gap = distRemaining / (s.switchesBeforePlatform - s.switchCount + 1);
                s.nextSwitchY = nextY - Math.max(1000, gap);
                
                // Reset decision
                s.lockedDecision = null;
                s.activeDecision = null;
                continue;
            }

            // 2. CHECK PLATFORM
            const distToPlatform = Math.abs(s.lastGenY - s.nextPlatformY);
            if (distToPlatform < step) {
                // STRAIGHT SECTION FOR PLATFORM
                // Force angle upright-ish
                const targetAngle = -Math.PI/2;
                s.lastGenAngle = s.lastGenAngle * 0.9 + targetAngle * 0.1;
                
                const nextX = s.lastGenX + Math.cos(s.lastGenAngle) * step;
                addPoint(nextX, nextY, s.lastGenAngle, 'PLATFORM', { platformSide: Math.random() > 0.5 ? 'LEFT' : 'RIGHT' });

                s.lastGenX = nextX;
                s.lastGenY = nextY;

                // Reset Cycle
                s.nextPlatformY = nextY - (MIN_PLATFORM_DIST + Math.random() * (MAX_PLATFORM_DIST - MIN_PLATFORM_DIST));
                s.switchesBeforePlatform = 2 + Math.floor(Math.random() * 3);
                s.switchCount = 0;
                // First switch in new cycle
                const cycleDist = Math.abs(nextY - s.nextPlatformY);
                s.nextSwitchY = nextY - (cycleDist / (s.switchesBeforePlatform + 1));
                continue;
            }

            // 3. NORMAL TRACK
            // Meandering
            const noise = Math.sin(nextY * 0.002) + Math.sin(nextY * 0.005) * 0.5;
            const targetAngle = -Math.PI/2 + (noise * 0.5); // Wander +/- 30 deg
            
            // Smoothly steer towards active decision if we are approaching a switch?
            // If we are approaching a switch (within 1000px), we might want to center or straighten?
            // Or if user is pressing LEFT, maybe we lean left?
            // Let's keep it auto-steering mostly, only hard turn at switch.
            
            s.lastGenAngle = s.lastGenAngle * 0.95 + targetAngle * 0.05;
            const nextX = s.lastGenX + Math.cos(s.lastGenAngle) * step;
            
            addPoint(nextX, nextY, s.lastGenAngle, 'NORMAL');
            
            s.lastGenX = nextX;
            s.lastGenY = nextY;
        }

        // Clean up old points
        const cleanThreshold = s.cameraY + (canvas.height/ZOOM) + 500;
        s.points = s.points.filter(p => p.y < cleanThreshold);
    };

    // --- UPDATE LOOP ---
    const update = () => {
        // Move Camera
        s.cameraY -= SPEED;

        // Check Switches Logic (UI)
        // Find nearest future switch
        // Since Y is negative, "future" means smaller Y (more negative)
        // We want s.nextSwitchY < s.cameraY
        
        const distToSwitch = Math.abs(s.cameraY - s.nextSwitchY);
        // Are we approaching it? (nextSwitchY is typically lower/more negative than cameraY)
        // Wait, s.nextSwitchY is generated ahead.
        
        if (distToSwitch < SWITCH_LOOKAHEAD && distToSwitch > 100 && !s.lockedDecision) {
             if (!showArrows) setShowArrows(true);
             setMsg("VÄXEL! VÄLJ SPÅR!");
             
             // Lock decision if close
             if (distToSwitch < 200) {
                 s.lockedDecision = s.activeDecision || (Math.random() > 0.5 ? 'LEFT' : 'RIGHT');
                 setShowArrows(false);
                 setMsg(s.lockedDecision === 'LEFT' ? "VÄNSTER SPÅR" : "HÖGER SPÅR");
             }
        } else {
             if (showArrows && distToSwitch > SWITCH_LOOKAHEAD) setShowArrows(false);
        }

        // Check Platform Delivery
        // Find platform point near camera (train is roughly at center screen)
        // Train Y is approx s.cameraY - (canvas.height/2/ZOOM)
        const trainScreenYOffset = (canvas.height / 2) / ZOOM;
        const trainY = s.cameraY - trainScreenYOffset;
        
        // Check if we passed a platform
        const passedPlatform = s.points.find(p => p.type === 'PLATFORM' && Math.abs(p.y - trainY) < 20);
        
        // Debounce using lastPlatformTime to avoid double delivery for same platform points
        if (passedPlatform && Date.now() - s.lastPlatformTime > 2000) {
            // Deliver!
            if (s.cars.length > 1) { // Always keep Loco
                // Remove last car
                const removed = s.cars.pop();
                setCargoLeft(s.cars.length - 1);
                s.lastPlatformTime = Date.now();
                setMsg(`LEVERERAT! ${removed?.type || 'GODS'} AVLASTAD!`);
                
                // Spawn Particles
                for(let i=0; i<10; i++) {
                    s.particles.push({
                        x: passedPlatform.x,
                        y: passedPlatform.y,
                        vx: (Math.random() - 0.5) * 10,
                        vy: (Math.random() - 0.5) * 10,
                        life: 1.0,
                        color: '#fbbf24'
                    });
                }

                // Change Biome occasionally
                const biomes: Biome[] = ['FOREST', 'DESERT', 'SNOW'];
                s.biome = biomes[Math.floor(Math.random() * biomes.length)];
                
                // WIN CONDITION
                if (s.cars.length === 1) {
                    setMsg("ALLT LEVERERAT! TÅGET GÅR HEM...");
                    setTimeout(onComplete, 3000);
                }
            }
        }

        // Update Particles
        s.particles.forEach(p => {
            p.x += p.vx;
            p.y += p.vy;
            p.life -= 0.02;
        });
        s.particles = s.particles.filter(p => p.life > 0);

        generateTrack();
    };

    // --- RENDER LOOP ---
    const draw = () => {
        // Resize
        if (canvas.width !== window.innerWidth) canvas.width = window.innerWidth;
        if (canvas.height !== window.innerHeight) canvas.height = window.innerHeight;

        const w = canvas.width;
        const h = canvas.height;

        ctx.fillStyle = s.biome === 'SNOW' ? '#f1f5f9' : s.biome === 'DESERT' ? '#fef08a' : '#86efac';
        ctx.fillRect(0, 0, w, h);

        ctx.save();
        
        // Camera Transform
        // We want the Train (at cameraY - offset) to be at Screen Center
        // So we translate everything by -cameraY + offset
        // Scaling
        ctx.scale(ZOOM, ZOOM);
        
        const screenCenterY = (h / ZOOM) / 2;
        const ty = -s.cameraY + screenCenterY;
        
        ctx.translate(0, ty); // Move world up
        // Also center X?
        // We need to follow train X roughly.
        // Find track point at trainY
        const trainY = s.cameraY - screenCenterY; // Rough world pos of train? No wait.
        // World Y increases down. Camera Y decreases (moves up).
        // Actually we defined cameraY as moving negative.
        // Let's stick to: Train is at s.cameraY in world space (roughly).
        // We render s.cameraY at screenCenterY.
        
        // Find X at s.cameraY to center camera horizontally
        const trackAtCam = s.points.find(p => Math.abs(p.y - s.cameraY) < 50) || s.points[s.points.length-1];
        const tx = trackAtCam ? -trackAtCam.x + (w/ZOOM)/2 : 0;
        
        ctx.translate(tx, 0);

        // DRAW SCENERY (Optimized)
        // Just random trees based on Y
        const startY = Math.floor((s.cameraY - screenCenterY)/500)*500;
        const endY = Math.floor((s.cameraY + screenCenterY)/500)*500;
        
        for(let y = startY; y > endY - 2000; y-=200) {
             // Deterministic pseudo-random
             const seed = Math.sin(y * 0.1);
             const treeX = seed * 1000; // Spread
             // Only draw if outside track area
             if (Math.abs(treeX - (trackAtCam?.x || 0)) > 200) {
                 drawTree(ctx, trackAtCam?.x + treeX + 400, y, s.biome);
                 drawTree(ctx, trackAtCam?.x - treeX - 400, y, s.biome);
             }
        }

        // DRAW TRACK
        // Sleepers
        ctx.strokeStyle = '#573c29';
        ctx.lineWidth = 40;
        ctx.lineCap = 'butt';
        ctx.setLineDash([10, 20]);
        ctx.beginPath();
        s.points.forEach((p, i) => {
           if (i===0) ctx.moveTo(p.x, p.y);
           else ctx.lineTo(p.x, p.y);
           
           // Draw Branch Decoy
           if (p.isBranch) {
               // Visual fork
               const branchAngle = p.angle + (Math.random() > 0.5 ? 0.5 : -0.5);
               const bx = p.x + Math.cos(branchAngle) * 200;
               const by = p.y + Math.sin(branchAngle) * 200;
               ctx.moveTo(p.x, p.y);
               ctx.lineTo(bx, by);
           }
        });
        ctx.stroke();
        ctx.setLineDash([]);

        // Rails
        ctx.strokeStyle = '#cbd5e1';
        ctx.lineWidth = 4;
        [-12, 12].forEach(offset => {
            ctx.beginPath();
            s.points.forEach((p, i) => {
                const ox = Math.cos(p.angle) * offset; // Rough offset perpendicular? No this is simple offset
                // Correct perpendicular offset
                const perp = p.angle + Math.PI/2;
                const dx = Math.cos(perp) * offset;
                const dy = Math.sin(perp) * offset;
                
                if (i===0) ctx.moveTo(p.x + dx, p.y + dy);
                else ctx.lineTo(p.x + dx, p.y + dy);
            });
            ctx.stroke();
        });

        // DRAW PLATFORMS
        s.points.forEach(p => {
            if (p.type === 'PLATFORM') {
                const side = p.platformSide === 'LEFT' ? -1 : 1;
                const px = p.x + (side * 80);
                
                ctx.fillStyle = '#9ca3af'; // concrete
                ctx.fillRect(px - 20, p.y - 100, 40, 200);
                
                // Roof
                ctx.fillStyle = '#ef4444';
                ctx.beginPath();
                ctx.moveTo(px - 25, p.y - 110);
                ctx.lineTo(px + 25, p.y - 110);
                ctx.lineTo(px + 25, p.y + 110);
                ctx.lineTo(px - 25, p.y + 110);
                ctx.fill();
                
                // Goods on platform
                if (p.y > s.cameraY) { // If future/past? 
                    // Just static goods
                    ctx.fillStyle = '#fbbf24';
                    ctx.fillRect(px - 10, p.y - 10, 20, 20);
                }
            }
        });

        // DRAW TRAIN
        // Train follows track at s.cameraY
        // We iterate cars and place them at s.cameraY + offset along track
        // We need to trace back along points
        let currentTrackIndex = s.points.findIndex(p => p.y <= s.cameraY);
        if (currentTrackIndex === -1) currentTrackIndex = 0;
        
        let distAccumulator = 0;
        let carIndex = 0;
        
        // We traverse points backwards (increasing Y) from camera
        for (let i = currentTrackIndex; i < s.points.length; i++) {
             if (carIndex >= s.cars.length) break;
             
             const p1 = s.points[i];
             const p2 = s.points[i+1];
             if (!p2) break;
             
             const segLen = Math.hypot(p2.x - p1.x, p2.y - p1.y);
             distAccumulator += segLen;
             
             const carSpacing = 60; // Space between cars
             
             if (distAccumulator > (carIndex * carSpacing) + 20) { // Offset start
                 drawCar(ctx, s.cars[carIndex], p1.x, p1.y, p1.angle);
                 carIndex++;
             }
        }

        // DRAW PARTICLES
        s.particles.forEach(p => {
            ctx.fillStyle = p.color;
            ctx.globalAlpha = p.life;
            ctx.beginPath();
            ctx.arc(p.x, p.y, 10, 0, Math.PI*2);
            ctx.fill();
            ctx.globalAlpha = 1;
        });

        ctx.restore();
    };

    const drawTree = (ctx: CanvasRenderingContext2D, x: number, y: number, biome: Biome) => {
        ctx.save();
        ctx.translate(x, y);
        if (biome === 'FOREST') {
            ctx.fillStyle = '#14532d';
            ctx.beginPath();
            ctx.arc(0, 0, 40, 0, Math.PI*2);
            ctx.fill();
            ctx.fillStyle = '#166534';
            ctx.beginPath();
            ctx.arc(0, -20, 30, 0, Math.PI*2);
            ctx.fill();
        } else if (biome === 'DESERT') {
             // Cactus
             ctx.fillStyle = '#65a30d';
             ctx.fillRect(-10, -40, 20, 40);
             ctx.fillRect(10, -30, 10, 10);
             ctx.fillRect(-20, -20, 10, 10);
        } else {
             // Pine
             ctx.fillStyle = '#334155';
             ctx.beginPath();
             ctx.moveTo(0, -60);
             ctx.lineTo(20, 0);
             ctx.lineTo(-20, 0);
             ctx.fill();
        }
        ctx.restore();
    };

    const drawCar = (ctx: CanvasRenderingContext2D, car: TrainCar, x: number, y: number, angle: number) => {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(angle + Math.PI/2); // Adjust angle
        
        const w = 30;
        const h = 50;
        
        // Shadow
        ctx.fillStyle = 'rgba(0,0,0,0.2)';
        ctx.fillRect(-w/2 + 5, -h/2 + 5, w, h);
        
        // Body
        ctx.fillStyle = car.type === 'LOCOMOTIVE' ? '#e11d48' : car.color;
        if (car.type === 'COAL') ctx.fillStyle = '#1f2937';
        
        ctx.beginPath();
        ctx.roundRect(-w/2, -h/2, w, h, 4);
        ctx.fill();
        
        // Detail
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.fillRect(-w/2+4, -h/2+4, w-8, h/3);
        
        ctx.restore();
    };

    // Loop
    const tick = () => {
       update();
       draw();
       frameId = requestAnimationFrame(tick);
    };
    tick();

    return () => {
        cancelAnimationFrame(frameId);
    };
  }, [cars]);

  return (
    <div className="fixed inset-0 z-50 bg-slate-900 text-white font-bold">
       <canvas ref={canvasRef} className="w-full h-full block" />
       
       {/* UI OVERLAY */}
       <div className="absolute top-4 left-0 right-0 flex justify-center pointer-events-none">
           <div className="bg-slate-800/80 backdrop-blur px-6 py-2 rounded-full border-2 border-slate-600 shadow-xl text-xl text-yellow-400">
              {msg}
           </div>
       </div>
       
       <div className="absolute top-4 right-4 pointer-events-none">
           <div className="bg-blue-600 px-4 py-2 rounded-xl border-4 border-blue-400 shadow-lg flex flex-col items-center">
              <span className="text-xs text-blue-200 uppercase">Gods kvar</span>
              <span className="text-3xl">{cargoLeft}</span>
           </div>
       </div>

       {showArrows && (
           <div className="absolute bottom-10 left-0 right-0 flex justify-between px-10 md:px-32 pointer-events-auto animate-pulse">
              <button 
                 onPointerDown={() => handleTurn('LEFT')}
                 className="w-32 h-32 bg-yellow-400 rounded-full border-b-8 border-yellow-600 active:border-b-0 active:translate-y-2 shadow-2xl flex items-center justify-center text-6xl text-yellow-900 hover:bg-yellow-300 transition-colors"
              >
                 ⬅
              </button>
              <button 
                 onPointerDown={() => handleTurn('RIGHT')}
                 className="w-32 h-32 bg-yellow-400 rounded-full border-b-8 border-yellow-600 active:border-b-0 active:translate-y-2 shadow-2xl flex items-center justify-center text-6xl text-yellow-900 hover:bg-yellow-300 transition-colors"
              >
                 ➡
              </button>
           </div>
       )}
    </div>
  );
};
