import os
import json
import uuid
from datetime import datetime
from kivy.app import App
from kivy.uix.boxlayout import BoxLayout
from kivy.uix.button import Button
from kivy.uix.label import Label
from kivy.clock import Clock
from plyer import gps, audio

# --- CONFIGURATION ---
STORAGE_DIR = "field_recordings"
if not os.path.exists(STORAGE_DIR):
    os.makedirs(STORAGE_DIR)

class FieldRecorderApp(App):
    def build(self):
        self.recording = False
        self.gps_coords = {"lat": 0.0, "lon": 0.0}
        self.current_id = None
        
        # UI Layout
        layout = BoxLayout(orientation='vertical', padding=20, spacing=20)
        
        self.status_label = Label(text="GPS: Waiting for signal...", font_size='18sp')
        layout.add_widget(self.status_label)
        
        self.record_btn = Button(
            text="REGISTRAR MOMENTO",
            background_color=(0.2, 0.7, 0.3, 1),
            font_size='24sp',
            on_press=self.toggle_recording
        )
        layout.add_widget(self.record_btn)
        
        self.indicator = Label(text="●", color=(1, 0, 0, 0), font_size='48sp')
        layout.add_widget(self.indicator)
        
        # Start GPS
        try:
            gps.configure(on_location=self.on_location, on_status=self.on_status)
            gps.start(minTime=1000, minDistance=1)
        except NotImplementedError:
            self.status_label.text = "GPS not available on this platform"
            
        return layout

    def on_location(self, **kwargs):
        self.gps_coords = {
            "lat": kwargs.get('lat', 0),
            "lon": kwargs.get('lon', 0)
        }
        self.status_label.text = f"GPS: {self.gps_coords['lat']:.6f}, {self.gps_coords['lon']:.6f}"

    def on_status(self, stype, status):
        pass

    def toggle_recording(self, instance):
        if not self.recording:
            self.start_recording()
        else:
            self.stop_recording()

    def start_recording(self):
        self.recording = True
        self.current_id = str(uuid.uuid4())
        self.record_btn.text = "DETENER REGISTRO"
        self.record_btn.background_color = (0.8, 0.2, 0.2, 1)
        self.indicator.color = (1, 0, 0, 1) # Red indicator
        
        # Audio filename
        filename = os.path.join(STORAGE_DIR, f"{self.current_id}.wav")
        
        # Start recording with Plyer
        try:
            audio.start_recording(filename)
        except Exception as e:
            print(f"Error recording: {e}")

    def stop_recording(self):
        self.recording = False
        self.record_btn.text = "REGISTRAR MOMENTO"
        self.record_btn.background_color = (0.2, 0.7, 0.3, 1)
        self.indicator.color = (1, 0, 0, 0) # Hide indicator
        
        try:
            audio.stop_recording()
            self.save_metadata()
        except Exception as e:
            print(f"Error stopping: {e}")

    def save_metadata(self):
        timestamp = datetime.now().isoformat()
        data = {
            "id": self.current_id,
            "timestamp": timestamp,
            "gps": self.gps_coords,
            "audio_file": f"{self.current_id}.wav",
            "metadata": {
                "format": "WAV",
                "sample_rate": 44100,
                "channels": 1,
                "artist": "Field Recorder Pro User"
            }
        }
        
        json_path = os.path.join(STORAGE_DIR, f"{self.current_id}.json")
        with open(json_path, 'w') as f:
            json.dump(data, f, indent=4)
        
        print(f"Saved recording {self.current_id}")

if __name__ == '__main__':
    FieldRecorderApp().run()
