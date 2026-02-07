
import React, { useRef, useEffect, useState } from 'react';
import { RubbleRatProbe } from '../services/simulation';
import { Point, Obstacle, ProbeStatus } from '../types';

interface MapViewProps {
  probes: RubbleRatProbe[];
  obstacles: Obstacle[];
  selectedProbeId: string | null;
  onProbeSelect: (id: string) => void;
  onMapClick: (pt: Point) => void;
  onAltClick: (pt: Point) => void;
  onFormationRequest: (pt: Point) => void;
  onAreaSelect: (rect: { x1: number, y1: number, x2: number, y2: number }) => void;
}

const MapView: React.FC<MapViewProps> = ({ 
  probes, 
  obstacles, 
  selectedProbeId, 
  onProbeSelect, 
  onMapClick, 
  onAltClick,
  onFormationRequest,
  onAreaSelect
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dragStart, setDragStart] = useState<Point | null>(null);
  const [dragCurrent, setDragCurrent] = useState<Point | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let frameId: number;

    const render = () => {
      // Clear
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Grid
      ctx.strokeStyle = 'rgba(0, 255, 136, 0.05)';
      ctx.lineWidth = 1;
      const gridSize = 40;
      for (let x = 0; x < canvas.width; x += gridSize) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
      }
      for (let y = 0; y < canvas.height; y += gridSize) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
      }

      // Draw Rubble Obstacles
      obstacles.forEach(obs => {
        ctx.fillStyle = '#1a1a1a';
        ctx.strokeStyle = '#2a2a2a';
        ctx.beginPath();
        ctx.arc(obs.x, obs.y, obs.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Rough texture
        ctx.fillStyle = '#222';
        for (let i = 0; i < 3; i++) {
           ctx.fillRect(obs.x - obs.radius/2 + i*5, obs.y - obs.radius/2, 4, 4);
        }
      });

      // Draw Mesh Connections
      ctx.lineWidth = 1;
      probes.forEach(p => {
        p.meshNeighbors.forEach(neighborId => {
          const neighbor = probes.find(n => n.id === neighborId);
          if (neighbor) {
            const dist = Math.sqrt(Math.pow(p.x - neighbor.x, 2) + Math.pow(p.y - neighbor.y, 2));
            const opacity = Math.max(0, 1 - dist / 150);
            ctx.strokeStyle = `rgba(59, 130, 246, ${opacity * 0.4})`;
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(neighbor.x, neighbor.y);
            ctx.stroke();
          }
        });
      });

      // Draw Probes
      probes.forEach(p => {
        const isSelected = p.id === selectedProbeId;
        const color = isSelected ? '#facc15' : p.battery < 15 ? '#ef4444' : '#00ff88';

        // Trail
        if (p.path.length > 1) {
          ctx.strokeStyle = `${color}22`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(p.path[0].x, p.path[0].y);
          p.path.forEach(pt => ctx.lineTo(pt.x, pt.y));
          ctx.stroke();
        }

        // Target Line
        if (isSelected && p.targetX !== null && p.targetY !== null) {
          ctx.setLineDash([5, 5]);
          ctx.strokeStyle = '#facc1544';
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.targetX, p.targetY);
          ctx.stroke();
          ctx.setLineDash([]);
          
          // Target Point
          ctx.fillStyle = '#facc15';
          ctx.beginPath(); ctx.arc(p.targetX, p.targetY, 3, 0, Math.PI * 2); ctx.fill();
        }

        // Probe Body
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.heading);
        
        // Alert Glow
        if (p.status === ProbeStatus.PAUSED || p.battery < 15) {
          ctx.shadowBlur = 10;
          ctx.shadowColor = p.battery < 15 ? 'red' : 'white';
        }

        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(8, 0);
        ctx.lineTo(-6, -6);
        ctx.lineTo(-6, 6);
        ctx.closePath();
        ctx.fill();

        // Direction indicator
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(10, 0);
        ctx.lineTo(15, 0);
        ctx.stroke();

        ctx.restore();

        // Label
        ctx.fillStyle = '#fff';
        ctx.font = '9px JetBrains Mono';
        ctx.fillText(p.id, p.x + 10, p.y - 10);
        
        // Battery bar mini
        ctx.fillStyle = '#333';
        ctx.fillRect(p.x - 10, p.y + 12, 20, 2);
        ctx.fillStyle = p.battery < 20 ? '#ef4444' : '#00ff88';
        ctx.fillRect(p.x - 10, p.y + 12, (p.battery / 100) * 20, 2);
      });

      // Draw Selection Rectangle
      if (dragStart && dragCurrent) {
        ctx.strokeStyle = '#00ff88';
        ctx.fillStyle = 'rgba(0, 255, 136, 0.1)';
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1;
        const x = Math.min(dragStart.x, dragCurrent.x);
        const y = Math.min(dragStart.y, dragCurrent.y);
        const w = Math.abs(dragStart.x - dragCurrent.x);
        const h = Math.abs(dragStart.y - dragCurrent.y);
        ctx.fillRect(x, y, w, h);
        ctx.strokeRect(x, y, w, h);
        ctx.setLineDash([]);
      }

      frameId = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(frameId);
  }, [probes, obstacles, selectedProbeId, dragStart, dragCurrent]);

  const getCanvasCoords = (e: React.MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const scaleX = canvasRef.current!.width / rect.width;
    const scaleY = canvasRef.current!.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY
    };
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    const coords = getCanvasCoords(e);

    // Only start drag if Alt is pressed (matching your "Area Scan" modifier) or if specifically clicking for rect
    if (e.altKey) {
      setDragStart(coords);
      setDragCurrent(coords);
    } else {
      // Check if clicked a probe
      const clickedProbe = probes.find(p => {
        const dist = Math.sqrt(Math.pow(p.x - coords.x, 2) + Math.pow(p.y - coords.y, 2));
        return dist < 15;
      });

      if (clickedProbe) {
        onProbeSelect(clickedProbe.id);
      } else {
        if (e.shiftKey) {
          onFormationRequest(coords);
        } else {
          onMapClick(coords);
        }
      }
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (dragStart) {
      setDragCurrent(getCanvasCoords(e));
    }
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (dragStart && dragCurrent) {
      const dist = Math.sqrt(Math.pow(dragStart.x - dragCurrent.x, 2) + Math.pow(dragStart.y - dragCurrent.y, 2));
      // If dragged enough, it's an area select
      if (dist > 10) {
        onAreaSelect({
          x1: dragStart.x,
          y1: dragStart.y,
          x2: dragCurrent.x,
          y2: dragCurrent.y
        });
      } else {
        // Just an alt click
        onAltClick(dragCurrent);
      }
    }
    setDragStart(null);
    setDragCurrent(null);
  };

  return (
    <div className="flex-grow w-full relative overflow-hidden">
      <canvas 
        ref={canvasRef}
        width={1400}
        height={1000}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        className="w-full h-full cursor-crosshair"
      />
      <div className="absolute bottom-4 right-4 text-[10px] opacity-40 bg-black/40 p-2 border border-emerald-500/20 pointer-events-none">
        CLICK: Target | ALT+DRAG: Rect Scan | ALT+CLICK: Single Scan | SHIFT+CLICK: Formation Point
      </div>
    </div>
  );
};

export default MapView;
