import cv2, numpy as np, onnxruntime as ort, time
obb=ort.InferenceSession('yolo11n-obb.onnx'); coco=ort.InferenceSession('/home/claude/slotify/slotify/frontend/public/models/yolo11n.onnx')
def letter(im,S):
    h,w=im.shape[:2]; sc=min(S/w,S/h); nw,nh=round(w*sc),round(h*sc); px,py=(S-nw)//2,(S-nh)//2
    c=np.full((S,S,3),114,np.uint8); c[py:py+nh,px:px+nw]=cv2.resize(im,(nw,nh))
    return c[:,:,::-1].transpose(2,0,1)[None].astype(np.float32)/255,sc,px,py
def run_obb(im,ms):
    x,sc,px,py=letter(im,1024); o=obb.run(None,{obb.get_inputs()[0].name:x})[0][0]
    best=o[4:19][[9,10]].max(0); out=[]
    for a in np.where(best>ms)[0]:
        cx,cy,bw,bh=o[:4,a]; ang=o[19,a]
        W_=abs(bw*np.cos(ang))+abs(bh*np.sin(ang)); H_=abs(bw*np.sin(ang))+abs(bh*np.cos(ang))
        out.append([(cx-W_/2-px)/sc,(cy-H_/2-py)/sc,W_/sc,H_/sc,float(best[a])])
    return out
def run_coco(im,ms):
    x,sc,px,py=letter(im,640); o=coco.run(None,{coco.get_inputs()[0].name:x})[0][0]
    s=o[[6,7,9,11]].max(0); out=[]
    for a in np.where(s>ms)[0]:
        cx,cy,bw,bh=o[:4,a]; out.append([(cx-bw/2-px)/sc,(cy-bh/2-py)/sc,bw/sc,bh/sc,float(s[a])])
    return out
def nms(L,t=0.35):
    L=sorted(L,key=lambda d:-d[4]); keep=[]
    for d in L:
        ok=True
        for k in keep:
            ix=max(0,min(k[0]+k[2],d[0]+d[2])-max(k[0],d[0])); iy=max(0,min(k[1]+k[3],d[1]+d[3])-max(k[1],d[1])); i=ix*iy
            if i/(k[2]*k[3]+d[2]*d[3]-i)>t or i/min(k[2]*k[3],d[2]*d[3])>0.6: ok=False;break
        if ok: keep.append(d)
    return keep
def tiles(im,fn,cols,rows,ms):
    H,W=im.shape[:2]; ov=0.2; tw=W/(cols-(cols-1)*ov); th=H/(rows-(rows-1)*ov); allb=[]
    for r in range(rows):
        for c in range(cols):
            x0,y0=int(c*tw*(1-ov)),int(r*th*(1-ov))
            for b in fn(im[y0:y0+int(th),x0:x0+int(tw)],ms): allb.append([b[0]+x0,b[1]+y0,b[2],b[3],b[4]])
    return allb
def detect(im):
    b=run_obb(im,0.25)+tiles(im,run_obb,2,2,0.25)+tiles(im,run_coco,3,2,0.3)
    b=[d for d in b if 15<d[2]<260 and 15<d[3]<260]
    return nms(b)
if __name__=='__main__':
    im=cv2.imread('f4.jpg'); t=time.time(); k=detect(im); print(len(k), round(time.time()-t,1),'s')
    for d in k: cv2.rectangle(im,(int(d[0]),int(d[1])),(int(d[0]+d[2]),int(d[1]+d[3])),(0,255,0),2)
    cv2.imwrite('f4_ens.jpg',im)
