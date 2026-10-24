import numpy as np
from PIL import Image
from sklearn.cluster import KMeans
for f in ['reference/DUST 1.jpg.jpeg','reference/SAMPUL DUST JPG.jpg.jpeg']:
    a=np.array(Image.open(f).convert('RGB')); full=a.reshape(-1,3)
    km=KMeans(7,n_init=3,random_state=1).fit(full[::13].astype(float)); cnt=np.bincount(km.labels_)
    print(f)
    for c,n in sorted(zip(km.cluster_centers_,cnt),key=lambda t:-t[1]):
        d=((full-c)**2).sum(1); i=d.argmin(); y,x=divmod(i,a.shape[1]); r,g,b=full[i]
        print('  %.3f #%02x%02x%02x x=%d y=%d'%(n/cnt.sum(),r,g,b,x,y))
