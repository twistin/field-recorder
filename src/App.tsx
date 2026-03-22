import React, { useState, useEffect, useRef } from 'react';
import { 
  Mic, 
  Square, 
  MapPin, 
  History, 
  Settings, 
  Play, 
  Trash2, 
  Download, 
  Image as ImageIcon, 
  Loader2,
  Activity,
  Wind,
  Volume2,
  Zap
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { v4 as uuidv4 } from 'uuid';
import { format } from 'date-fns';
import { GoogleGenAI } from "@google/genai";

// --- TYPES ---
interface Recording {
  id: string;
  timestamp: string;
  gps: { lat: number; lon: number };
  audioUrl: string;
  duration: number;
  imageUrl?: string;
  prompt?: string;
}

// --- APP COMPONENT ---
export default function App() {
  const [isRecording, setIsRecording] = useState(false);
  const [isWalkMode, setIsWalkMode] = useState(false);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [currentGps, setCurrentGps] = useState<{ lat: number; lon: number } | null>(null);
  const [recordingTime, setRecordingTime] = useState(0);
  const [view, setView] = useState<'record' | 'history' | 'python'>('record');
  const [isGeneratingImage, setIsGeneratingImage] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const walkModeIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // --- GPS TRACKING ---
  useEffect(() => {
    if ("geolocation" in navigator) {
      const watchId = navigator.geolocation.watchPosition(
        (position) => {
          setCurrentGps({
            lat: position.coords.latitude,
            lon: position.coords.longitude
          });
        },
        (error) => console.error("GPS Error:", error),
        { enableHighAccuracy: true }
      );
      return () => navigator.geolocation.clearWatch(watchId);
    }
  }, []);

  // --- AUDIO LOGIC ---
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/wav' });
        const audioUrl = URL.createObjectURL(audioBlob);
        
        const newRecording: Recording = {
          id: uuidv4(),
          timestamp: new Date().toISOString(),
          gps: currentGps || { lat: 0, lon: 0 },
          audioUrl,
          duration: recordingTime
        };

        setRecordings(prev => [newRecording, ...prev]);
        setRecordingTime(0);
      };

      mediaRecorder.start();
      setIsRecording(true);
      
      timerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);

    } catch (err) {
      console.error("Microphone access denied:", err);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (timerRef.current) clearInterval(timerRef.current);
    }
  };

  // --- WALK MODE (BUFFER RECORDING) ---
  const toggleWalkMode = () => {
    if (!isWalkMode) {
      setIsWalkMode(true);
      // Simulate continuous buffer recording every 30 seconds
      walkModeIntervalRef.current = setInterval(() => {
        console.log("Walk Mode: Auto-saving buffer...");
        // In a real app, we'd slice the current stream buffer here
      }, 30000);
    } else {
      setIsWalkMode(false);
      if (walkModeIntervalRef.current) clearInterval(walkModeIntervalRef.current);
    }
  };

  // --- GEMINI IMAGE GENERATION ---
  const generateSoundscape = async (recording: Recording) => {
    setIsGeneratingImage(recording.id);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const prompt = `A cinematic, abstract digital art piece representing a soundscape at coordinates ${recording.gps.lat}, ${recording.gps.lon}. The mood is ${recording.duration > 10 ? 'complex and layered' : 'minimal and focused'}. Style: Atmospheric, high-detail, artistic interpretation of field recordings.`;
      
      const response = await ai.models.generateContent({
        model: 'gemini-3.1-flash-image-preview',
        contents: [{ parts: [{ text: prompt }] }],
      });

      let imageUrl = "";
      for (const part of response.candidates[0].content.parts) {
        if (part.inlineData) {
          imageUrl = `data:image/png;base64,${part.inlineData.data}`;
          break;
        }
      }

      setRecordings(prev => prev.map(r => 
        r.id === recording.id ? { ...r, imageUrl, prompt } : r
      ));
    } catch (err) {
      console.error("Image generation failed:", err);
    } finally {
      setIsGeneratingImage(null);
    }
  };

  const deleteRecording = (id: string) => {
    setRecordings(prev => prev.filter(r => r.id !== id));
  };

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-[#E0E0E0] font-sans selection:bg-emerald-500/30">
      
      {/* Header */}
      <header className="fixed top-0 w-full z-50 bg-[#0A0A0A]/80 backdrop-blur-md border-b border-white/5 px-6 py-4 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-emerald-500 rounded-lg flex items-center justify-center">
            <Volume2 className="text-black w-5 h-5" />
          </div>
          <h1 className="text-lg font-semibold tracking-tight">FIELD RECORDER <span className="text-emerald-500">PRO</span></h1>
        </div>
        <div className="flex gap-4">
          <button onClick={() => setView('record')} className={`p-2 rounded-full transition-colors ${view === 'record' ? 'bg-emerald-500/10 text-emerald-500' : 'text-zinc-500 hover:text-white'}`}>
            <Mic className="w-5 h-5" />
          </button>
          <button onClick={() => setView('history')} className={`p-2 rounded-full transition-colors ${view === 'history' ? 'bg-emerald-500/10 text-emerald-500' : 'text-zinc-500 hover:text-white'}`}>
            <History className="w-5 h-5" />
          </button>
          <button onClick={() => setView('python')} className={`p-2 rounded-full transition-colors ${view === 'python' ? 'bg-emerald-500/10 text-emerald-500' : 'text-zinc-500 hover:text-white'}`}>
            <Settings className="w-5 h-5" />
          </button>
        </div>
      </header>

      <main className="pt-24 pb-32 px-6 max-w-2xl mx-auto">
        
        {view === 'record' && (
          <div className="space-y-12">
            {/* GPS Status */}
            <div className="bg-zinc-900/50 border border-white/5 rounded-2xl p-6 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 bg-zinc-800 rounded-xl flex items-center justify-center">
                  <MapPin className="text-emerald-500 w-5 h-5" />
                </div>
                <div>
                  <p className="text-xs text-zinc-500 uppercase tracking-widest font-bold">Location Status</p>
                  <p className="text-sm font-mono">
                    {currentGps ? `${currentGps.lat.toFixed(6)}, ${currentGps.lon.toFixed(6)}` : "Acquiring GPS..."}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${currentGps ? 'bg-emerald-500 animate-pulse' : 'bg-zinc-700'}`} />
                <span className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">Active</span>
              </div>
            </div>

            {/* Main Recorder */}
            <div className="flex flex-col items-center justify-center py-12 space-y-8">
              <div className="relative">
                <AnimatePresence>
                  {isRecording && (
                    <motion.div 
                      initial={{ scale: 0.8, opacity: 0 }}
                      animate={{ scale: 1.2, opacity: 1 }}
                      exit={{ scale: 0.8, opacity: 0 }}
                      className="absolute inset-0 bg-emerald-500/20 rounded-full blur-3xl"
                    />
                  )}
                </AnimatePresence>
                
                <button 
                  onClick={isRecording ? stopRecording : startRecording}
                  className={`relative w-48 h-48 rounded-full flex flex-col items-center justify-center transition-all duration-500 ${
                    isRecording 
                    ? 'bg-red-500 shadow-[0_0_50px_rgba(239,68,68,0.4)]' 
                    : 'bg-emerald-500 hover:scale-105 shadow-[0_0_30px_rgba(16,185,129,0.2)]'
                  }`}
                >
                  {isRecording ? (
                    <Square className="w-12 h-12 text-white fill-white" />
                  ) : (
                    <Mic className="w-12 h-12 text-black" />
                  )}
                  <span className={`mt-4 text-xs font-bold uppercase tracking-widest ${isRecording ? 'text-white' : 'text-black'}`}>
                    {isRecording ? "Stop Recording" : "Register Moment"}
                  </span>
                </button>
              </div>

              <div className="text-center space-y-2">
                <p className="text-5xl font-mono font-light tracking-tighter">
                  {format(recordingTime * 1000, 'mm:ss')}
                </p>
                <p className="text-xs text-zinc-500 uppercase tracking-widest font-bold">
                  {isRecording ? "Recording in progress" : "Ready to capture"}
                </p>
              </div>
            </div>

            {/* Walk Mode Toggle */}
            <div className="flex justify-center">
              <button 
                onClick={toggleWalkMode}
                className={`flex items-center gap-3 px-6 py-3 rounded-full border transition-all ${
                  isWalkMode 
                  ? 'bg-emerald-500/10 border-emerald-500/50 text-emerald-500' 
                  : 'bg-zinc-900/50 border-white/5 text-zinc-400 hover:text-white'
                }`}
              >
                <Activity className={`w-4 h-4 ${isWalkMode ? 'animate-pulse' : ''}`} />
                <span className="text-xs font-bold uppercase tracking-widest">Walk Mode {isWalkMode ? 'ON' : 'OFF'}</span>
              </button>
            </div>
          </div>
        )}

        {view === 'history' && (
          <div className="space-y-6">
            <div className="flex justify-between items-center mb-8">
              <h2 className="text-2xl font-bold tracking-tight">Library</h2>
              <span className="text-xs text-zinc-500 font-mono">{recordings.length} items</span>
            </div>
            
            <AnimatePresence mode="popLayout">
              {recordings.length === 0 ? (
                <div className="text-center py-20 text-zinc-600">
                  <History className="w-12 h-12 mx-auto mb-4 opacity-20" />
                  <p>No recordings yet</p>
                </div>
              ) : (
                recordings.map((rec) => (
                  <motion.div 
                    key={rec.id}
                    layout
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="bg-zinc-900/40 border border-white/5 rounded-2xl overflow-hidden"
                  >
                    <div className="p-5 space-y-4">
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="text-xs text-zinc-500 font-mono mb-1">{format(new Date(rec.timestamp), 'MMM d, yyyy · HH:mm:ss')}</p>
                          <div className="flex items-center gap-2 text-emerald-500">
                            <MapPin className="w-3 h-3" />
                            <span className="text-[10px] font-mono">{rec.gps.lat.toFixed(4)}, {rec.gps.lon.toFixed(4)}</span>
                          </div>
                        </div>
                        <button 
                          onClick={() => deleteRecording(rec.id)}
                          className="p-2 text-zinc-600 hover:text-red-400 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>

                      <div className="flex items-center gap-4 bg-black/20 rounded-xl p-3">
                        <button className="w-10 h-10 bg-emerald-500 rounded-full flex items-center justify-center text-black">
                          <Play className="w-4 h-4 fill-black" />
                        </button>
                        <div className="flex-1 h-1 bg-zinc-800 rounded-full overflow-hidden">
                          <div className="h-full bg-emerald-500 w-1/3" />
                        </div>
                        <span className="text-[10px] font-mono text-zinc-500">{format(rec.duration * 1000, 'mm:ss')}</span>
                      </div>

                      {rec.imageUrl ? (
                        <div className="relative group">
                          <img 
                            src={rec.imageUrl} 
                            alt="Soundscape" 
                            className="w-full aspect-video object-cover rounded-xl border border-white/5"
                            referrerPolicy="no-referrer"
                          />
                          <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center p-6 text-center">
                            <p className="text-[10px] italic text-zinc-300">"{rec.prompt}"</p>
                          </div>
                        </div>
                      ) : (
                        <button 
                          onClick={() => generateSoundscape(rec)}
                          disabled={isGeneratingImage === rec.id}
                          className="w-full py-3 rounded-xl border border-dashed border-zinc-800 text-zinc-500 hover:text-emerald-500 hover:border-emerald-500/30 transition-all flex items-center justify-center gap-2"
                        >
                          {isGeneratingImage === rec.id ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <ImageIcon className="w-4 h-4" />
                          )}
                          <span className="text-[10px] uppercase tracking-widest font-bold">
                            {isGeneratingImage === rec.id ? "Generating Visual..." : "Generate Soundscape Visual"}
                          </span>
                        </button>
                      )}
                    </div>
                  </motion.div>
                ))
              )}
            </AnimatePresence>
          </div>
        )}

        {view === 'python' && (
          <div className="space-y-6">
            <div className="flex items-center gap-3 mb-8">
              <Zap className="text-emerald-500 w-6 h-6" />
              <h2 className="text-2xl font-bold tracking-tight">Android Source (Kivy)</h2>
            </div>
            
            <div className="bg-zinc-900 border border-white/5 rounded-2xl p-6 overflow-hidden">
              <div className="flex justify-between items-center mb-4">
                <span className="text-xs font-mono text-zinc-500">main.py</span>
                <button className="text-[10px] uppercase tracking-widest font-bold text-emerald-500">Copy Code</button>
              </div>
              <pre className="text-[10px] font-mono text-zinc-400 overflow-x-auto leading-relaxed">
{`import os
import json
import uuid
from datetime import datetime
from kivy.app import App
from kivy.uix.boxlayout import BoxLayout
from plyer import gps, audio

class FieldRecorderApp(App):
    def build(self):
        # ... UI Setup ...
        return layout

    def start_recording(self):
        self.current_id = str(uuid.uuid4())
        filename = os.path.join("recordings", f"{self.current_id}.wav")
        audio.start_recording(filename)

    def save_metadata(self):
        data = {
            "id": self.current_id,
            "gps": self.gps_coords,
            "timestamp": datetime.now().isoformat()
        }
        # Save to JSON...`}
              </pre>
            </div>

            <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-2xl p-6 space-y-4">
              <h3 className="text-sm font-bold text-emerald-500 uppercase tracking-widest">Buildozer Instructions</h3>
              <ol className="text-xs space-y-3 text-zinc-400 list-decimal list-inside">
                <li>Install Buildozer: <code className="bg-black/40 px-1 rounded">pip install buildozer</code></li>
                <li>Initialize: <code className="bg-black/40 px-1 rounded">buildozer init</code></li>
                <li>Edit <code className="bg-black/40 px-1 rounded">buildozer.spec</code> (permissions included in source)</li>
                <li>Build APK: <code className="bg-black/40 px-1 rounded">buildozer android debug deploy run</code></li>
              </ol>
            </div>
          </div>
        )}
      </main>

      {/* Footer Navigation (Mobile Only) */}
      <nav className="fixed bottom-0 w-full bg-[#0A0A0A]/80 backdrop-blur-md border-t border-white/5 px-8 py-4 flex justify-around items-center md:hidden">
        <button onClick={() => setView('record')} className={view === 'record' ? 'text-emerald-500' : 'text-zinc-500'}>
          <Mic className="w-6 h-6" />
        </button>
        <button onClick={() => setView('history')} className={view === 'history' ? 'text-emerald-500' : 'text-zinc-500'}>
          <History className="w-6 h-6" />
        </button>
        <button onClick={() => setView('python')} className={view === 'python' ? 'text-emerald-500' : 'text-zinc-500'}>
          <Settings className="w-6 h-6" />
        </button>
      </nav>
    </div>
  );
}
