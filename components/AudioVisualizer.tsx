
import React, { useRef, useEffect } from 'react';

interface AudioVisualizerProps {
  analyser: AnalyserNode | null;
  muted: boolean;
}

const AudioVisualizer: React.FC<AudioVisualizerProps> = ({ analyser, muted }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId: number;
    const bufferLength = analyser ? analyser.frequencyBinCount : 0;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      animationId = requestAnimationFrame(draw);
      
      const width = canvas.width;
      const height = canvas.height;
      
      ctx.clearRect(0, 0, width, height);
      
      if (analyser && !muted) {
        analyser.getByteTimeDomainData(dataArray);
      } else {
        // Flat line if muted or no analyser
        dataArray.fill(128);
      }

      ctx.lineWidth = 2;
      ctx.strokeStyle = muted ? '#ef4444' : '#10b981';
      ctx.beginPath();

      const sliceWidth = width / bufferLength;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0;
        const y = (v * height) / 2;

        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }

        x += sliceWidth;
      }

      ctx.lineTo(width, height / 2);
      ctx.stroke();

      // Background decorative lines
      ctx.lineWidth = 0.5;
      ctx.strokeStyle = 'rgba(16, 185, 129, 0.1)';
      ctx.beginPath();
      ctx.moveTo(0, height / 2);
      ctx.lineTo(width, height / 2);
      ctx.stroke();
    };

    draw();

    return () => cancelAnimationFrame(animationId);
  }, [analyser, muted]);

  return (
    <canvas 
      ref={canvasRef} 
      width={400} 
      height={64} 
      className="w-full h-full"
    />
  );
};

export default AudioVisualizer;
