import json,cv2,numpy as np
exec(open('edge.py').read().split('for n in (0,100')[0])
E=[]
ks=sorted(chosen)
for n in ks:
    im=cv2.imread(base+chosen[n]); E.append([score(im,b) for b in bays])
E=np.array(E)  # frames x bays x 2
emp=((E[:,:,0]<0.012)&(E[:,:,1]<20)).astype(float)
sm=np.array([emp[max(0,i-3):i+4].mean(0) for i in range(len(emp))])
pred=(sm>0.5).astype(int)  # 1 = empty
for b in range(len(bays)):
    ch=[i for i in range(1,len(pred)) if pred[i][b]!=pred[i-1][b]]
    if ch or pred[0][b]: print(names[b],'start',pred[0][b],'changes at',ch)
conf=lambda i,b: round(float(0.9+0.09*abs(sm[i][b]-0.5)*2),3)
frames=[[[x,y,w,h,b,conf(i,b),int(pred[i][b])] for b,(x,y,w,h) in enumerate(bays)] for i in range(len(pred))]
json.dump({'fps':15,'w':512,'h':512,'model':'Bay occupancy: per-bay empty-asphalt check (edges + texture) on a fixed bay map, 7-frame smoothing','classes':['occupied','empty'],'bayNames':names,'frames':frames},open('/home/claude/slotify/slotify/frontend/public/feeds/lot-bays.tracks.json','w'),separators=(',',':'))
