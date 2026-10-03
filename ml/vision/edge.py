import json,cv2,numpy as np
chosen={int(k):v for k,v in json.load(open('kds_chosen.json')).items()}
base="kds/Car_Parking_Detection.v1i.yolov8 (1)/Car_Parking_Detection.v1i.yolov8 (1)/"
ys=[0,60,127,194,262,330,398,470]; cols=[(88,279),(283,478)]
bays=[(x0,ys[r],x1-x0,ys[r+1]-ys[r]) for r in range(7) for (x0,x1) in cols]
names=[f"{'AB'[c]}{r+1}" for r in range(7) for c in range(2)]
def score(im,b):
    x,y,w,h=b; g=cv2.cvtColor(im,cv2.COLOR_BGR2GRAY)[y+int(h*.22):y+int(h*.78), x+int(w*.12):x+int(w*.88)]
    e=cv2.Canny(cv2.GaussianBlur(g,(3,3),0),60,140).mean()/255
    return round(e,3), round(float(g.std()),1)
for n in (0,100,150,200,300):
    im=cv2.imread(base+chosen[n]); print(n,{names[i]:score(im,b) for i,b in enumerate(bays)})
