import cv2, json, numpy as np, glob, time
from ens import detect
files=sorted(glob.glob('frames/*.jpg')); out=[]
t=time.time()
for f in files:
    out.append([[round(float(v),1) for v in d[:4]]+[round(float(d[4]),2)] for d in detect(cv2.imread(f))])
json.dump(out,open('raw_dets.json','w')); print(len(out), round(time.time()-t), 's', [len(x) for x in out[:5]])
