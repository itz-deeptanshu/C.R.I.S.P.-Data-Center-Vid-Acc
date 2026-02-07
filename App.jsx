import React, { useState, useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';

import { 
  Activity, 
  Battery, 
  Map as MapIcon, 
  ShieldAlert, 
  Radio, 
  Zap, 
  Play, 
  Square, 
  Plus, 
  Home, 
  AlertTriangle,
  Wifi,
  Thermometer,
  Mic2,
  MicOff,
  Wind,
  Navigation,
  Key,
  Radar,
  Video,
  Flame,
  Joystick,
  Search,
  ExternalLink,
  Send,
  Boxes,
  Target,
  RotateCcw,
  Waves
} from 'lucide-react';
import { GoogleGenAI } from '@google/genai';
import { RubbleRatProbe } from './services/simulation';
import { ProbeStatus, FormationType } from './types';
import MapView from './components/MapView';
import GyroViz from './components/GyroViz';
import AudioVisualizer from './components/AudioVisualizer';

const BASE_LOCATION = { x: 50, y: 50 };

const App = () => {
  const socket = useRef(io('http://localhost:5000')).current;
  const [probes, setProbes] = useState([]);
  const [selectedProbeId, setSelectedProbeId] = useState(null);
  const [obstacles, setObstacles] = useState([]);
  const [transcription, setTranscription] = useState([]);
  const [isSimulationRunning, setIsSimulationRunning] = useState(true);
  const [detectionAlert, setDetectionAlert] = useState(null);
  const [interactionMode, setInteractionMode] = useState('NAV');
  const [activeCameraFeed, setActiveCameraFeed] = useState('HD');
  const [pressedKeys, setPressedKeys] = useState(new Set());
  
  const [chatHistory, setChatHistory] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [isSearching, setIsSearching] = useState(false);

  // Real-time media states
  const [liveStream, setLiveStream] = useState(null);
  const [micLevel, setMicLevel] = useState(0);
  const [isMicMuted, setIsMicMuted] = useState(false);
  const videoRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  
  const simulationRef = useRef(null);
  const chatEndRef = useRef(null);

  // Initialize Media (Camera & Mic)
  useEffect(() => {
    async function initMedia() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
          video: { width: 1280, height: 720 }, 
          audio: true 
        });
        setLiveStream(stream);

        // Setup Audio Analyser
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        
        audioContextRef.current = audioCtx;
        analyserRef.current = analyser;

        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        const updateMicLevel = () => {
          if (analyserRef.current && !isMicMuted) {
            analyserRef.current.getByteFrequencyData(dataArray);
            const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
            // Map average (0-255) to a Decibel-like scale (30-160) for the simulation
            setMicLevel(30 + (average / 255) * 130);
          } else {
            setMicLevel(0);
          }
          requestAnimationFrame(updateMicLevel);
        };
        updateMicLevel();

      } catch (err) {
        console.error("Media access failed:", err);
      }
    }
    initMedia();

    return () => {
      if (liveStream) {
        liveStream.getTracks().forEach(track => track.stop());
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, [isMicMuted]);

  // Connect video stream to video element
  useEffect(() => {
    if (videoRef.current && liveStream) {
      videoRef.current.srcObject = liveStream;
    }
  }, [liveStream, activeCameraFeed]);

  useEffect(() => {
    const initialProbes = [
      new RubbleRatProbe(`P01`, 300, 300)
    ];
    setProbes(initialProbes);
    setSelectedProbeId('P01');

    const initialObstacles = Array.from({ length: 15 }).map(() => ({
      x: 100 + Math.random() * 800,
      y: 100 + Math.random() * 600,
      radius: 15 + Math.random() * 25,
      type: 'rubble'
    }));
    setObstacles(initialObstacles);
    
    setChatHistory([{
      role: 'assistant',
      text: 'Tactical Analyst online. C.R.I.S.P. systems primed. Select a fleet operation or individual unit to begin.'
    }]);
  }, []);

  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatHistory]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;
      const key = e.key.toLowerCase();
      setPressedKeys(prev => {
        const next = new Set(prev);
        next.add(key);
        return next;
      });

      if (selectedProbeId) {
        if (key === 'q') {
          setProbes(prev => prev.map(p => {
            if (p.id === selectedProbeId) {
              p.status = p.status === ProbeStatus.PAUSED ? ProbeStatus.IDLE : ProbeStatus.PAUSED;
            }
            return p;
          }));
        }
        if (key === 'r') {
          setProbes(prev => prev.map(p => {
            if (p.id === selectedProbeId) p.status = ProbeStatus.RETRACING;
            return p;
          }));
        }
      }
    };

    const handleKeyUp = (e) => {
      const key = e.key.toLowerCase();
      setPressedKeys(prev => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [selectedProbeId]);

  const handleDetection = useCallback((probe) => {
    setDetectionAlert({ probeId: probe.id, location: { x: probe.x, y: probe.y } });
    setTranscription(prev => [...prev.slice(-4), `[CRITICAL - ${probe.id}] Potential bio-signature at ${Math.round(probe.x)}, ${Math.round(probe.y)}`]);
  }, []);
  useEffect(() => {
      // This listens for the 'survivor_detected' event from your Python server.py
      socket.on('survivor_detected', (data) => {
        // Find the probe in your current state
        const targetProbe = probes.find(p => p.id === data.probeId);
        
        if (targetProbe) {
          // This calls YOUR existing function (line 173) to show the red popup
          handleDetection(targetProbe);
        }
      });
  
      // Cleanup when the component unmounts
      return () => {
        socket.off('survivor_detected');
      };
    }, [probes, handleDetection]);

  useEffect(() => {
    const tick = () => {
      if (!isSimulationRunning) return;

      setProbes(prevProbes => {
        const nextProbes = [...prevProbes];
        nextProbes.forEach(p => {
          // Update microphone sensor with real data if it's the selected probe
          if (p.id === selectedProbeId) {
            p.sensors.microphone = micLevel;
          }

          if (p.id === selectedProbeId && p.status !== ProbeStatus.PAUSED && document.activeElement?.tagName !== 'INPUT') {
            const moveSpeed = 2;
            let moved = false;
            if (pressedKeys.has('w')) { p.y -= moveSpeed; moved = true; }
            if (pressedKeys.has('s')) { p.y += moveSpeed; moved = true; }
            if (pressedKeys.has('a')) { p.x -= moveSpeed; moved = true; }
            if (pressedKeys.has('d')) { p.x += moveSpeed; moved = true; }
            
            if (moved) {
              p.targetX = null;
              p.targetY = null;
              p.status = ProbeStatus.MOVING;
              if (pressedKeys.has('w')) p.heading = -Math.PI / 2;
              if (pressedKeys.has('s')) p.heading = Math.PI / 2;
              if (pressedKeys.has('a')) p.heading = Math.PI;
              if (pressedKeys.has('d')) p.heading = 0;
            }
          }

          const neighbors = nextProbes.filter(other => {
            if (other.id === p.id) return false;
            const dist = Math.sqrt(Math.pow(p.x - other.x, 2) + Math.pow(p.y - other.y, 2));
            return dist < 150;
          });
          p.meshNeighbors = neighbors.map(n => n.id);
          p.update(obstacles, nextProbes, BASE_LOCATION, handleDetection);
        });
        return [...nextProbes];
      });

      simulationRef.current = requestAnimationFrame(tick);
    };

    simulationRef.current = requestAnimationFrame(tick);
    return () => {
      if (simulationRef.current) cancelAnimationFrame(simulationRef.current);
    };
  }, [isSimulationRunning, obstacles, handleDetection, selectedProbeId, pressedKeys, micLevel]);

  const deployNewProbe = () => {
    const newId = `P${(probes.length + 1).toString().padStart(2, '0')}`;
    const newProbe = new RubbleRatProbe(newId, BASE_LOCATION.x, BASE_LOCATION.y);
    setProbes([...probes, newProbe]);
  };

  const fleetSweep = () => {
    setProbes(prev => prev.map(p => {
      p.targetX = Math.random() * 1000 + 100;
      p.targetY = Math.random() * 600 + 100;
      p.status = ProbeStatus.SCANNING;
      return p;
    }));
  };

  const returnAllToBase = () => {
    setProbes(prev => prev.map(p => {
      p.targetX = BASE_LOCATION.x;
      p.targetY = BASE_LOCATION.y;
      p.status = ProbeStatus.RETURNING;
      return p;
    }));
  };

  const emergencyStop = () => {
    setProbes(prev => prev.map(p => {
      p.status = ProbeStatus.PAUSED;
      p.targetX = null;
      p.targetY = null;
      return p;
    }));
  };

  const applyFormation = (type, center) => {
    setProbes(prev => {
      const next = [...prev];
      const count = next.length;
      next.forEach((p, i) => {
        let tx = center.x;
        let ty = center.y;
        const spacing = 60;
        switch (type) {
          case FormationType.CIRCLE:
            const angle = (i / count) * Math.PI * 2;
            tx += Math.cos(angle) * (spacing * 1.5);
            ty += Math.sin(angle) * (spacing * 1.5);
            break;
          case FormationType.SQUARE:
            const side = Math.ceil(Math.sqrt(count));
            const row = Math.floor(i / side);
            const col = i % side;
            tx += (col - side/2) * spacing;
            ty += (row - side/2) * spacing;
            break;
          case FormationType.WEDGE:
            const level = Math.floor(Math.sqrt(i + 1));
            const pos = i - level * level;
            tx += level * spacing;
            ty += (pos - level / 2) * spacing;
            break;
        }
        p.targetX = tx;
        p.targetY = ty;
        p.status = ProbeStatus.MOVING;
      });
      return next;
    });
  };

  const individualFocusedScan = (id) => {
    setProbes(prev => prev.map(p => {
      if (p.id === id) {
        p.targetX = p.x + (Math.random() - 0.5) * 150;
        p.targetY = p.y + (Math.random() - 0.5) * 150;
        p.status = ProbeStatus.SCANNING;
      }
      return p;
    }));
  };

  const scanArea = (center) => {
    let nearest = null;
    let minDist = Infinity;
    probes.forEach(p => {
      const d = Math.sqrt(Math.pow(p.x - center.x, 2) + Math.pow(p.y - center.y, 2));
      if (d < minDist) {
        minDist = d;
        nearest = p;
      }
    });
    if (nearest) {
      setProbes(prev => prev.map(p => {
        if (p.id === nearest.id) {
          p.targetX = center.x;
          p.targetY = center.y;
          p.status = ProbeStatus.SCANNING;
        }
        return p;
      }));
      setInteractionMode('NAV');
    }
  };

  const handleAreaSelect = (rect) => {
    const minX = Math.min(rect.x1, rect.x2);
    const minY = Math.min(rect.y1, rect.y2);
    const maxX = Math.max(rect.x1, rect.x2);
    const maxY = Math.max(rect.y1, rect.y2);
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    const sortedProbes = [...probes].sort((a, b) => {
      const distA = Math.sqrt(Math.pow(a.x - centerX, 2) + Math.pow(a.y - centerY, 2));
      const distB = Math.sqrt(Math.pow(b.x - centerX, 2) + Math.pow(b.y - centerY, 2));
      return distA - distB;
    });

    const probesToAssign = sortedProbes.slice(0, 3);
    const ids = probesToAssign.map(p => p.id);

    setProbes(prev => prev.map(p => {
      if (ids.includes(p.id)) {
        const index = ids.indexOf(p.id);
        p.targetX = minX + (maxX - minX) * (0.2 + 0.6 * (index / 2));
        p.targetY = minY + (maxY - minY) * (0.2 + 0.6 * Math.random());
        p.status = ProbeStatus.SCANNING;
      }
      return p;
    }));
  };

  const handleMapClick = (pt) => {
    if (interactionMode === 'SCAN_AREA') {
      scanArea(pt);
    } else if (selectedProbeId) {
      setProbes(prev => prev.map(p => {
        if (p.id === selectedProbeId) {
          p.targetX = pt.x;
          p.targetY = pt.y;
          p.status = ProbeStatus.MOVING;
        }
        return p;
      }));
    }
  };

  const handleSearchSubmit = async (e) => {
    e.preventDefault();
    if (!chatInput.trim() || isSearching) return;
    const userQuery = chatInput.trim();
    setChatInput('');
    setChatHistory(prev => [...prev, { role: 'user', text: userQuery }]);
    setIsSearching(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: userQuery,
        config: {
          systemInstruction: 'You are a C.R.I.S.P. Tactical Intelligence Agent. Provide brief, professional, military-grade mission intel using real-time search. Focus on disaster zones, environmental factors, and rescue technology.',
          tools: [{ googleSearch: {} }]
        }
      });
      const text = response.text || "Unable to retrieve data at this time.";
      const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
      const sources = chunks?.map((c) => ({
        uri: c.web?.uri || '',
        title: c.web?.title || 'Source'
      })).filter((s) => s.uri !== '') || [];
      setChatHistory(prev => [...prev, { role: 'assistant', text, sources }]);
    } catch (err) {
      console.error(err);
      setChatHistory(prev => [...prev, { role: 'assistant', text: 'ERR: Uplink failed. Search service unavailable.' }]);
    } finally {
      setIsSearching(false);
    }
  };

  const toggleMic = () => {
    if (liveStream) {
      const audioTrack = liveStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMicMuted(!audioTrack.enabled);
      }
    }
  };

  const selectedProbe = probes.find(p => p.id === selectedProbeId);
  const isAnyControlKeyPressed = ['w', 'a', 's', 'd'].some(k => pressedKeys.has(k)) && document.activeElement?.tagName !== 'INPUT';

  return (
    <div className="flex h-screen w-full select-none overflow-hidden bg-black text-xs text-white">
      {/* Sidebar: Probe Management & Operations */}
      <div className="w-[25%] flex flex-col border-r border-emerald-500/30 bg-black/40 backdrop-blur-md p-4 space-y-6">
        <div className="flex items-center gap-2">
          <Activity className="text-emerald-400 w-5 h-5" />
          <h1 className="text-lg font-bold tracking-widest text-emerald-400 uppercase">C.R.I.S.P. DATA CENTRE</h1>
        </div>

        <div className="flex flex-col gap-2 overflow-y-auto flex-grow pr-1 custom-scrollbar">
          <div className="flex items-center justify-between text-[10px] text-emerald-400 font-bold uppercase tracking-widest opacity-60 mb-1">
            <span>Unit Roster</span>
            <span>{probes.length} Active</span>
          </div>
          {probes.map(probe => (
            <div 
              key={probe.id}
              onClick={() => setSelectedProbeId(probe.id)}
              className={`p-2 border cursor-pointer transition-all duration-200 ${
                selectedProbeId === probe.id 
                  ? 'border-yellow-400 bg-yellow-400/10' 
                  : 'border-emerald-500/20 hover:border-emerald-500/50 bg-white/5'
              } ${probe.battery < 15 || probe.status === ProbeStatus.PAUSED ? 'alert-pulse' : ''}`}
            >
              <div className="flex justify-between items-center">
                <span className={`font-bold ${selectedProbeId === probe.id ? 'text-yellow-400' : 'text-emerald-400'}`}>
                  {probe.id}
                </span>
                <span className={`px-1 text-[8px] rounded border ${
                  probe.status === ProbeStatus.ALERT || probe.status === ProbeStatus.PAUSED ? 'border-red-500 text-red-500' :
                  'border-emerald-500/40 text-emerald-400/60'
                }`}>
                  {probe.status}
                </span>
              </div>
              <div className="mt-1 w-full h-1 bg-white/10 rounded-full overflow-hidden">
                <div 
                  className={`h-full ${probe.battery > 50 ? 'bg-emerald-500' : probe.battery > 20 ? 'bg-yellow-500' : 'bg-red-500'}`}
                  style={{ width: `${probe.battery}%` }}
                />
              </div>
            </div>
          ))}
          <button onClick={deployNewProbe} className="w-full flex items-center justify-center gap-2 p-2 mt-1 border border-dashed border-emerald-500/40 hover:bg-emerald-500/10 text-emerald-400/60 rounded">
            <Plus className="w-4 h-4" /> DEPLOY REINFORCEMENT
          </button>
        </div>

        <div className="space-y-2 border-t border-emerald-500/30 pt-4">
          <div className="text-[10px] text-emerald-400 font-bold uppercase tracking-widest opacity-60 flex items-center gap-2 mb-1">
            <Boxes className="w-3 h-3" /> Fleet Operations
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={fleetSweep} className="flex items-center justify-center gap-2 p-2 bg-emerald-600/20 border border-emerald-500/40 hover:bg-emerald-600/40 text-emerald-400 font-bold rounded">
              <Waves className="w-3 h-3" /> FLEET SWEEP
            </button>
            <button 
              onClick={() => setInteractionMode(prev => prev === 'SCAN_AREA' ? 'NAV' : 'SCAN_AREA')} 
              className={`flex items-center justify-center gap-2 p-2 border font-bold rounded transition-colors ${
                interactionMode === 'SCAN_AREA' 
                ? 'bg-yellow-400 text-black border-yellow-400' 
                : 'border-emerald-500/50 hover:bg-emerald-500/20 text-emerald-400'
              }`}
            >
              <Radar className="w-3 h-3" /> SECTOR SCAN
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => applyFormation(FormationType.CIRCLE, { x: 500, y: 400 })} className="p-2 border border-blue-500/40 hover:bg-blue-500/20 text-blue-400 font-bold rounded">
              CIRCLE FORM.
            </button>
            <button onClick={() => applyFormation(FormationType.WEDGE, { x: 500, y: 400 })} className="p-2 border border-blue-500/40 hover:bg-blue-500/20 text-blue-400 font-bold rounded">
              WEDGE FORM.
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={returnAllToBase} className="flex items-center justify-center gap-2 p-2 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded">
              <Home className="w-3 h-3" /> RECALL ALL
            </button>
            <button onClick={emergencyStop} className="flex items-center justify-center gap-2 p-2 bg-red-600 hover:bg-red-500 text-white font-bold rounded alert-pulse">
              <ShieldAlert className="w-3 h-3" /> GLOBAL STOP
            </button>
          </div>
        </div>

        {selectedProbe && (
          <div className="space-y-2 border-t border-yellow-500/30 pt-4 animate-in slide-in-from-bottom duration-300">
            <div className="text-[10px] text-yellow-400 font-bold uppercase tracking-widest opacity-80 flex items-center gap-2 mb-1">
              <Target className="w-3 h-3" /> Unit: {selectedProbe.id} Tactics
            </div>
            <div className="grid grid-cols-1 gap-2">
              <button onClick={() => individualFocusedScan(selectedProbe.id)} className="flex items-center justify-center gap-2 p-2 bg-yellow-400/20 border border-yellow-400/50 hover:bg-yellow-400/40 text-yellow-400 font-bold rounded">
                <Radar className="w-3 h-3" /> FOCUSED LOCAL SCAN
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button 
                onClick={() => setProbes(prev => prev.map(p => {
                  if (p.id === selectedProbe.id) p.status = ProbeStatus.RETRACING;
                  return p;
                }))}
                className="flex items-center justify-center gap-1.5 p-2 bg-white/5 border border-white/20 hover:bg-white/10 text-white font-bold rounded"
              >
                <RotateCcw className="w-3 h-3" /> RETRACE
              </button>
              <button 
                onClick={() => setProbes(prev => prev.map(p => {
                  if (p.id === selectedProbe.id) {
                    p.targetX = BASE_LOCATION.x;
                    p.targetY = BASE_LOCATION.y;
                    p.status = ProbeStatus.RETURNING;
                  }
                  return p;
                }))}
                className="flex items-center justify-center gap-1.5 p-2 bg-white/5 border border-white/20 hover:bg-white/10 text-white font-bold rounded"
              >
                <Home className="w-3 h-3" /> BASE RTB
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="relative w-[70%] h-full bg-[#050505] flex flex-col">
        <div className="absolute top-4 left-4 z-10 flex gap-4 items-center bg-black/60 p-2 rounded border border-emerald-500/30 backdrop-blur-sm">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
            <span className="text-emerald-400 font-bold">SYSTEM ACTIVE</span>
          </div>
          <div className="h-4 w-[1px] bg-white/20"></div>
          <span className="opacity-60 uppercase">Sector 07-A Rubble Field</span>
          {interactionMode === 'SCAN_AREA' && (
            <div className="flex items-center gap-2 text-yellow-400 font-bold text-[10px] animate-pulse">
              <Radar className="w-3 h-3" /> CLICK TO DEFINE SCAN REGION
            </div>
          )}
          {isAnyControlKeyPressed && (
            <div className="flex items-center gap-2 text-blue-400 font-bold text-[10px]">
              <Joystick className="w-3 h-3" /> MANUAL OVERRIDE ENGAGED
            </div>
          )}
        </div>

        <MapView 
          probes={probes}
          obstacles={obstacles}
          selectedProbeId={selectedProbeId}
          onProbeSelect={setSelectedProbeId}
          onMapClick={handleMapClick}
          onAltClick={scanArea}
          onAreaSelect={handleAreaSelect}
          onFormationRequest={(pt) => applyFormation(FormationType.SQUARE, pt)}
        />

        {detectionAlert && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 w-max max-w-lg bg-red-950/90 border border-red-500 p-4 rounded shadow-2xl animate-bounce">
            <div className="flex items-center gap-3">
              <AlertTriangle className="text-red-500 w-8 h-8" />
              <div>
                <h3 className="font-bold text-lg text-red-500 uppercase leading-tight">CRITICAL DETECTION</h3>
                <p className="text-white/80">Probe {detectionAlert.probeId} reports potential life-sign. Unit motion suspended.</p>
                <div className="mt-3 flex gap-2">
                  <button onClick={() => {
                    setProbes(prev => prev.map(p => {
                      if (p.id === detectionAlert.probeId) p.status = ProbeStatus.SCANNING;
                      return p;
                    }));
                    setDetectionAlert(null);
                  }} className="px-4 py-2 bg-red-600 rounded text-xs font-bold hover:bg-red-500 transition shadow-lg flex items-center gap-2">
                    <Play className="w-3 h-3" /> RESUME MISSION
                  </button>
                  <button onClick={() => setDetectionAlert(null)} className="px-4 py-2 bg-white/10 rounded text-xs hover:bg-white/20">ACKNOWLEDGE</button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="w-[30%] border-l border-emerald-500/30 bg-black/40 backdrop-blur-md flex flex-col overflow-hidden">
        {selectedProbe ? (
          <div className="flex flex-col h-full overflow-hidden">
            <div className="p-4 border-b border-emerald-500/30 flex justify-between items-center bg-black/20">
              <div>
                <h2 className="text-lg font-bold text-yellow-400 tracking-tight">{selectedProbe.id} FEED</h2>
                <p className="text-[10px] opacity-60">STATUS: {selectedProbe.status}</p>
              </div>
              <button 
                onClick={() => setProbes(prev => prev.map(p => {
                  if (p.id === selectedProbe.id) p.status = p.status === ProbeStatus.PAUSED ? ProbeStatus.IDLE : ProbeStatus.PAUSED;
                  return p;
                }))}
                className={`p-2 rounded ${selectedProbe.status === ProbeStatus.PAUSED ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}
              >
                {selectedProbe.status === ProbeStatus.PAUSED ? <Play className="w-4 h-4" /> : <Square className="w-4 h-4" />}
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 p-4 flex-shrink-0">
              <SensorCard icon={<Thermometer />} label="TEMP" value={`${selectedProbe.sensors.temperature.toFixed(1)}°C`} />
              <div className="relative">
                <SensorCard 
                  icon={isMicMuted ? <MicOff /> : <Mic2 />} 
                  label="AUDIO" 
                  value={`${selectedProbe.sensors.microphone.toFixed(0)}dB`} 
                  alert={selectedProbe.sensors.microphone > 140} 
                  subLabel={isMicMuted ? "MUTED" : "LIVE"}
                  onAction={toggleMic}
                />
              </div>
              <SensorCard icon={<Wind />} label="CO₂" value={`${selectedProbe.sensors.co2.toFixed(0)}ppm`} alert={selectedProbe.sensors.co2 > 750} />
              <SensorCard icon={<Zap />} label="US" value={`${selectedProbe.sensors.ultrasonic.toFixed(0)}cm`} alert={selectedProbe.sensors.ultrasonic < 30} />
              <SensorCard icon={<Wifi />} label="WiFi HAlow" value={`${selectedProbe.sensors.loraSignal.toFixed(0)}dBm`} />
              <SensorCard icon={<Activity />} label="THERMAL" value={`${selectedProbe.sensors.thermal.toFixed(1)}°C`} alert={selectedProbe.sensors.thermal > 35} />
            </div>

            <div className="px-4 py-2 space-y-4 flex-grow overflow-y-auto custom-scrollbar">
              <div className="space-y-1">
                <div className="flex justify-between items-center">
                  <span className="text-[10px] text-emerald-500 font-bold uppercase tracking-wider flex items-center gap-1.5">
                    <Video className="w-3 h-3" /> Visual Link
                  </span>
                  <div className="flex gap-1 bg-white/5 p-0.5 rounded border border-emerald-500/20">
                    <button onClick={() => setActiveCameraFeed('HD')} className={`px-2 py-0.5 rounded text-[8px] font-bold transition-all ${activeCameraFeed === 'HD' ? 'bg-emerald-500 text-black' : 'text-emerald-500/60'}`}>HD</button>
                    <button onClick={() => setActiveCameraFeed('THERMAL')} className={`px-2 py-0.5 rounded text-[8px] font-bold transition-all ${activeCameraFeed === 'THERMAL' ? 'bg-orange-500 text-black' : 'text-orange-500/60'}`}>IR</button>
                  </div>
                </div>
                <div className="h-48 relative border border-emerald-500/20 rounded overflow-hidden bg-black shadow-inner">
                  {liveStream ? (
                    <div className="w-full h-full relative">
                      <video 
                        ref={videoRef}
                        autoPlay
                        muted
                        playsInline
className={`w-full h-full object-cover transition-all duration-500 ${
  activeCameraFeed === 'THERMAL' 
    ? 'grayscale invert contrast-200 hue-rotate-180 brightness-150' 
    : 'brightness-100 contrast-100'
}`}                      />
                      <div className="absolute inset-0 pointer-events-none border-[1px] border-emerald-500/10 flex flex-col justify-between p-2">
                        <div className="flex justify-between">
                          <div className="flex items-center gap-1.5 bg-black/60 px-2 py-1 rounded">
                            <div className={`w-1.5 h-1.5 rounded-full animate-pulse ${activeCameraFeed === 'HD' ? 'bg-red-500' : 'bg-orange-500'}`}></div>
                            <span className="text-[8px] font-bold">{activeCameraFeed === 'HD' ? '1080P_LIVE' : 'FLIR_THERM'}</span>
                          </div>
                          <div className="text-[8px] font-bold bg-black/40 px-1 py-0.5 rounded">
                            {new Date().toISOString().split('T')[1].split('.')[0]}
                          </div>
                        </div>
                        <div className="flex justify-center">
                           <div className="w-24 h-24 border border-white/20 relative">
                             <div className="absolute top-1/2 left-0 w-full h-[1px] bg-white/10"></div>
                             <div className="absolute left-1/2 top-0 w-[1px] h-full bg-white/10"></div>
                           </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center bg-white/5 animate-pulse">
                      <Video className="w-8 h-8 opacity-20" />
                    </div>
                  )}
                </div>
              </div>

              {/* Audio Waveform Viz */}
              <div className="space-y-1">
                <span className="text-[10px] text-emerald-400 font-bold uppercase tracking-wider flex items-center gap-2">
                  <Activity className="w-3 h-3" /> Audio Spectrum Analysis
                </span>
                <div className="h-16 bg-black/40 border border-emerald-500/20 rounded overflow-hidden">
                  <AudioVisualizer analyser={analyserRef.current} muted={isMicMuted} />
                </div>
              </div>

              <div className="space-y-2">
                <span className="text-[10px] text-blue-500 font-bold uppercase tracking-wider flex items-center gap-2">
                  <Navigation className="w-3 h-3" /> Inertial IMU
                </span>
                <GyroViz gyro={selectedProbe.gyro} />
              </div>

              <div className="space-y-1">
                <span className="text-[10px] text-blue-400 font-bold uppercase tracking-wider flex items-center gap-2">
                  <Search className="w-3 h-3" /> Tactical Analyst
                </span>
                <div className="bg-black/40 border border-blue-500/20 rounded flex flex-col h-60 overflow-hidden shadow-xl">
                  <div className="flex-grow overflow-y-auto p-2 space-y-2 custom-scrollbar text-[10px]">
                    {chatHistory.map((msg, i) => (
                      <div key={i} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                        <div className={`max-w-[90%] p-2 rounded ${msg.role === 'user' ? 'bg-blue-600/20 border border-blue-500/30' : 'bg-emerald-950/20 border border-emerald-500/30'}`}>
                          {msg.text}
                        </div>
                        {msg.sources && msg.sources.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {msg.sources.map((s, idx) => (
                              <a key={idx} href={s.uri} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 px-1.5 py-0.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-[2px] text-[8px] text-blue-400">
                                <ExternalLink className="w-2 h-2" /> {s.title.slice(0, 15)}...
                              </a>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                    {isSearching && <div className="flex items-center gap-2 text-blue-400 animate-pulse italic"><Activity className="w-3 h-3 animate-spin" /> Uplinking...</div>}
                    <div ref={chatEndRef} />
                  </div>
                  <form onSubmit={handleSearchSubmit} className="p-2 border-t border-blue-500/20 flex gap-2 bg-black/60">
                    <input 
                      type="text" 
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      placeholder="Query Fleet Intel..."
                      className="flex-grow bg-white/5 border border-white/10 rounded px-2 py-1 focus:outline-none focus:border-blue-500 transition-colors text-[10px]"
                    />
                    <button type="submit" disabled={isSearching} className="p-1 bg-blue-600 hover:bg-blue-500 rounded disabled:opacity-30">
                      <Send className="w-3 h-3" />
                    </button>
                  </form>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-grow flex flex-col items-center justify-center opacity-30 text-center p-10">
            <MapIcon className="w-16 h-16 mb-4" />
            <p className="text-sm font-bold uppercase tracking-widest">Select probe for telemetry link</p>
          </div>
        )}
      </div>
    </div>
  );
};

const SensorCard = ({ icon, label, value, alert, subLabel, onAction }) => (
  <div 
    onClick={onAction}
    className={`p-2 border rounded flex flex-col transition-all group ${onAction ? 'cursor-pointer hover:border-emerald-500/60 active:scale-95' : ''} ${alert ? 'bg-red-500/20 border-red-500 alert-pulse' : 'bg-white/5 border-emerald-500/20'}`}
  >
    <div className="flex items-center justify-between mb-1 opacity-60">
      <div className="flex items-center gap-2">
        {React.cloneElement(icon, { className: 'w-3 h-3' })}
        <span className="text-[8px] font-bold tracking-tighter uppercase">{label}</span>
      </div>
      {subLabel && <span className={`text-[7px] font-bold px-1 rounded bg-black/40 ${subLabel === 'MUTED' ? 'text-red-400' : 'text-emerald-400'}`}>{subLabel}</span>}
    </div>
    <div className="flex items-end justify-between">
      <div className={`text-sm font-bold ${alert ? 'text-red-400' : 'text-emerald-400'}`}>{value}</div>
      {onAction && <div className="text-[7px] opacity-0 group-hover:opacity-60 uppercase font-bold text-white/40">Toggle</div>}
    </div>
  </div>
);

export default App;
