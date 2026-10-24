import sys, struct, glob, numpy as np
from PIL import Image
from sklearn.cluster import KMeans
for f in sorted(glob.glob('brand/*')+glob.glob('reference/*')):
    raw=open(f,'rb').read()
    print('==',f,len(raw),'bytes', raw[:4].hex())
    if raw[:8]==b'\x89PNG\r\n\x1a\n':
        w,h,bd,ct=struct.unpack('>IIBB',raw[16:26]); print(' IHDR',w,h,'bitdepth',bd,'colortype',ct)
    im=Image.open(f); print(' mode',im.mode,im.size)
    a=np.array(im.convert('RGBA'))
    al=a[...,3]; print(' alpha min/max',al.min(),al.max(),'transparent px',int((al==0).sum()),'partial',int(((al>0)&(al<255)).sum()))
    if (al==0).any():
        z=a[al==0][:,:3]; print(' pure-black among transparent:',int((z.sum(1)==0).sum()),'of',len(z))
    if 'brand' in f:
        px=a[...,:3].reshape(-1,3)[::17].astype(float)
        km=KMeans(6,n_init=3,random_state=1).fit(px)
        cnt=np.bincount(km.labels_)
        full=a[...,:3].reshape(-1,3)
        for c,n in sorted(zip(km.cluster_centers_,cnt),key=lambda t:-t[1]):
            d=((full-c)**2).sum(1); i=d.argmin(); y,x=divmod(i,a.shape[1]); r,g,b=full[i]
            print('  cluster share %.3f snapped #%02x%02x%02x at x=%d y=%d'%(n/cnt.sum(),r,g,b,x,y))
