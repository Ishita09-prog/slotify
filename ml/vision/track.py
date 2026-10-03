import json, numpy as np, cv2, glob
raw=json.load(open('raw_dets.json'))
def iou(a,b):
    ix=max(0,min(a[0]+a[2],b[0]+b[2])-max(a[0],b[0])); iy=max(0,min(a[1]+a[3],b[1]+b[3])-max(a[1],b[1])); i=ix*iy
    return i/(a[2]*a[3]+b[2]*b[3]-i+1e-6)
tracks=[]  # dict: box, hits, first,last, boxes{f:box}
for f,dets in enumerate(raw):
    used=set()
    pairs=sorted([(iou(t['box'],d),ti,di) for ti,t in enumerate(tracks) if f-t['last']<=6 for di,d in enumerate(dets)],reverse=True)
    mt=set()
    for s,ti,di in pairs:
        if s<0.3: break
        if ti in mt or di in used: continue
        t=tracks[ti]; d=dets[di]
        t['box']=[0.6*t['box'][k]+0.4*d[k] for k in range(4)]; t['hits']+=1; t['last']=f; t['boxes'][f]=t['box'][:]; t['score']=max(t['score'],d[4])
        mt.add(ti); used.add(di)
    for di,d in enumerate(dets):
        if di not in used: tracks.append({'box':d[:4],'hits':1,'first':f,'last':f,'boxes':{f:d[:4]},'score':d[4]})
good=[t for t in tracks if t['hits']>=6]
N=len(raw)
frames=[[] for _ in range(N)]
for tid,t in enumerate(good):
    # static car (moved < 25px): show on all frames with its mean box; moving: interpolate between seen frames
    ks=sorted(t['boxes']); bs=np.array([t['boxes'][k] for k in ks])
    moved=np.ptp(bs[:,0])+np.ptp(bs[:,1])
    if moved<40:
        m=bs.mean(0); rng=range(N) if t['hits']>=N*0.25 else range(ks[0],ks[-1]+1)
        for f in rng: frames[f].append([round(float(v),1) for v in m]+[tid,round(t['score'],2)])
    else:
        for f in range(ks[0],ks[-1]+1):
            k0=max([k for k in ks if k<=f]); k1=min([k for k in ks if k>=f])
            a=np.array(t['boxes'][k0]); b=np.array(t['boxes'][k1]); w=0 if k1==k0 else (f-k0)/(k1-k0)
            frames[f].append([round(float(v),1) for v in a*(1-w)+b*w]+[tid,round(t['score'],2)])
print('tracks',len(tracks),'good',len(good),'per frame',[len(x) for x in frames[::15]])
json.dump({'fps':6,'w':1920,'h':1080,'frames':frames},open('tracks.json','w'),separators=(',',':'))
# render preview
files=sorted(glob.glob('frames/*.jpg'))
vw=cv2.VideoWriter('preview.mp4',cv2.VideoWriter_fourcc(*'mp4v'),6,(1920,1080))
for f,fn in enumerate(files):
    im=cv2.imread(fn)
    for x,y,w,h,tid,s in frames[f]: cv2.rectangle(im,(int(x),int(y)),(int(x+w),int(y+h)),(0,220,0),2)
    cv2.putText(im,f'{len(frames[f])} vehicles',(30,60),cv2.FONT_HERSHEY_SIMPLEX,1.6,(0,255,255),4)
    vw.write(im)
    if f==37: cv2.imwrite('track_mid.jpg',im)
vw.release()
