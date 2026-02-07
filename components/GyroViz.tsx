
import React, { useRef, useEffect } from 'react';
import { Gyroscope } from '../types';

interface GyroVizProps {
  gyro: Gyroscope;
}

const GyroViz: React.FC<GyroVizProps> = ({ gyro }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;
      const size = 30;

      // Simple 3D wireframe cube projection
      const points = [
        { x: -1, y: -1, z: -1 }, { x: 1, y: -1, z: -1 },
        { x: 1, y: 1, z: -1 }, { x: -1, y: 1, z: -1 },
        { x: -1, y: -1, z: 1 }, { x: 1, y: -1, z: 1 },
        { x: 1, y: 1, z: 1 }, { x: -1, y: 1, z: 1 }
      ];

      const degToRad = (deg: number) => (deg * Math.PI) / 180;
      const pitch = degToRad(gyro.pitch);
      const roll = degToRad(gyro.roll);
      const yaw = degToRad(gyro.yaw);

      const projectedPoints = points.map(p => {
        // Rotation around X (pitch)
        let y = p.y * Math.cos(pitch) - p.z * Math.sin(pitch);
        let z = p.y * Math.sin(pitch) + p.z * Math.cos(pitch);
        let x = p.x;

        // Rotation around Y (yaw)
        let x2 = x * Math.cos(yaw) + z * Math.sin(yaw);
        let z2 = -x * Math.sin(yaw) + z * Math.cos(yaw);
        let y2 = y;

        // Rotation around Z (roll)
        let x3 = x2 * Math.cos(roll) - y2 * Math.sin(roll);
        let y3 = x2 * Math.sin(roll) + y2 * Math.cos(roll);

        // Simple perspective
        const perspective = 200 / (200 + z2);
        return {
          x: centerX + x3 * size * perspective,
          y: centerY + y3 * size * perspective
        };
      });

      const drawLine = (i: number, j: number, color: string) => {
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.moveTo(projectedPoints[i].x, projectedPoints[i].y);
        ctx.lineTo(projectedPoints[j].x, projectedPoints[j].y);
        ctx.stroke();
      };

      // Draw Cube Edges
      ctx.setLineDash([]);
      const cubeColor = 'rgba(59, 130, 246, 0.8)';
      const frontColor = '#00ff88';
      
      // Bottom face
      drawLine(0, 1, cubeColor); drawLine(1, 2, cubeColor); drawLine(2, 3, cubeColor); drawLine(3, 0, cubeColor);
      // Top face
      drawLine(4, 5, frontColor); drawLine(5, 6, frontColor); drawLine(6, 7, frontColor); drawLine(7, 4, frontColor);
      // Pillars
      drawLine(0, 4, cubeColor); drawLine(1, 5, cubeColor); drawLine(2, 6, cubeColor); drawLine(3, 7, cubeColor);

      // Add "Front" marker
      ctx.fillStyle = frontColor;
      ctx.beginPath();
      ctx.arc(projectedPoints[4].x, projectedPoints[4].y, 2, 0, Math.PI * 2);
      ctx.fill();
    };

    render();
  }, [gyro]);

  return (
    <div className="flex flex-col gap-2 p-2 bg-white/5 border border-white/10 rounded">
      <div className="flex justify-between items-center mb-1">
         <span className="text-[8px] font-bold text-blue-400 opacity-60 uppercase">Orientation Matrix</span>
         <div className="flex gap-2">
            <span className="text-[8px] font-bold text-emerald-400">P:{gyro.pitch.toFixed(1)}°</span>
            <span className="text-[8px] font-bold text-emerald-400">R:{gyro.roll.toFixed(1)}°</span>
            <span className="text-[8px] font-bold text-emerald-400">Y:{gyro.yaw.toFixed(1)}°</span>
         </div>
      </div>
      <div className="flex items-center justify-center bg-black/40 rounded py-2 border border-white/5">
        <canvas 
          ref={canvasRef} 
          width={120} 
          height={80} 
          className="w-full h-20"
        />
      </div>
      <div className="grid grid-cols-3 gap-1">
        <MiniGraph label="PITCH" value={gyro.pitch} color="emerald" />
        <MiniGraph label="ROLL" value={gyro.roll} color="blue" />
        <MiniGraph label="YAW" value={gyro.yaw % 360} max={360} color="yellow" />
      </div>
    </div>
  );
};

const MiniGraph: React.FC<{ label: string, value: number, max?: number, color: string }> = ({ label, value, max = 45, color }) => {
  const percentage = Math.min(100, Math.abs((value / max) * 100));
  const colorMap: Record<string, string> = {
    emerald: 'bg-emerald-500',
    blue: 'bg-blue-500',
    yellow: 'bg-yellow-500'
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between text-[7px] font-bold opacity-50">
        <span>{label}</span>
      </div>
      <div className="h-1 bg-white/10 rounded-full overflow-hidden">
        <div 
          className={`h-full transition-all duration-300 ${colorMap[color]}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
};

export default GyroViz;
