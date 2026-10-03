# Edge-box vision pipeline (what runs next to the camera)

- `ens.py`  – vehicle detection: YOLO11n (COCO) + YOLO11n-OBB (DOTA aerial), full frame + overlapping tiles, merged with NMS.
- `pre.py`  – runs detection on every frame (6 fps) of a recorded clip.
- `track.py`– IoU tracker; static cars keep one stable box, moving cars are interpolated -> `lot-aerial.tracks.json`.
- `edge.py`, `clip2.py` – bay occupancy on a fixed bay map (empty-asphalt check: edge density + texture, 7-frame smoothing)
  for the Kaggle/Roboflow "Car_Parking_Detection" clip (CC BY 4.0) -> `lot-bays.tracks.json`.

The browser camera wall (`/command/cameras`) plays the clip and draws these per-frame results in sync,
the same JSON an edge device would stream. Models: ultralytics YOLO11 release assets (AGPL-3.0).
