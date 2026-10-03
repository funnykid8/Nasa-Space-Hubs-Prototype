import csv, io, json, math, os, re, threading, time
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs, urlencode
from urllib.request import Request, urlopen

HOST=os.environ.get('HOST','0.0.0.0'); PORT=int(os.environ.get('PORT','8000'))
NASA_GDS='https://oderest.rsl.wustl.edu/livegds'
ROOT=os.path.dirname(os.path.abspath(__file__))
CACHE={}
LOCK=threading.Lock()


def fetch(url, timeout=45):
    req=Request(url, headers={'User-Agent':'LunarLandingAnalyzer/3.0 NASA-Space-Apps-Prototype'})
    with urlopen(req, timeout=timeout) as r:
        return r.read()


def gds(params, timeout=45):
    q=dict(params); q['output']='JSON'
    return fetch(NASA_GDS+'?'+urlencode(q), timeout).decode('utf-8','replace')


def urls_from_text(s):
    return re.findall(r'https?://[^\"\'<>\s]+', s)


def find_urls(obj):
    out=[]
    if isinstance(obj, dict):
        for v in obj.values(): out += find_urls(v)
    elif isinstance(obj, list):
        for v in obj: out += find_urls(v)
    elif isinstance(obj, str) and obj.startswith('http'):
        out.append(obj)
    return out


def get_result_files(text):
    try:
        obj=json.loads(text)
        return find_urls(obj)
    except Exception:
        return urls_from_text(text)


def csv_rows(url):
    raw=fetch(url, 60).decode('utf-8-sig','replace')
    # Some generated files include a small preamble; locate the first CSV header.
    lines=raw.splitlines()
    start=0
    for i,line in enumerate(lines):
        if 'Pt_Longitude' in line or 'Topography' in line or 'Tb' in line:
            start=i; break
    data='\n'.join(lines[start:])
    try:
        return list(csv.DictReader(io.StringIO(data)))
    except Exception:
        return []


def num(row, *names):
    for n in names:
        for k,v in row.items():
            if k.strip().lower()==n.lower():
                try:
                    x=float(str(v).strip())
                    if math.isfinite(x): return x
                except: pass
    return None


def normalize_lon(lon):
    x=lon%360
    return x


def lola(lat, lon, half=0.035):
    west=normalize_lon(lon-half); east=normalize_lon(lon+half)
    if east < west: # GDS bbox is simpler if we don't cross 0
        west=max(0, west); east=min(360, east)
    params={'query':'lolardr','results':'ut','westernlon':f'{west:.5f}','easternlon':f'{east:.5f}',
            'minlat':f'{max(-90,lat-half):.5f}','maxlat':f'{min(90,lat+half):.5f}'}
    text=gds(params)
    files=get_result_files(text)
    topo_url=next((u for u in files if 'topo' in u.lower() or u.lower().endswith('.csv')), None)
    if not topo_url:
        return {'status':'NO_DATA','source':'NASA GDS / LOLA RDR','raw_summary':text[:500]}
    rows=csv_rows(topo_url)
    pts=[]
    for r in rows:
        la=num(r,'Pt_Latitude','Latitude'); lo=num(r,'Pt_Longitude','Longitude'); z=num(r,'Topography')
        if la is not None and lo is not None and z is not None:
            pts.append((la,lo,z))
    if not pts:
        return {'status':'NO_DATA','source':'NASA GDS / LOLA RDR','file':topo_url}
    # nearest weighted elevation
    def dist(p):
        la,lo,_=p; dx=(lo-lon)*math.cos(math.radians(lat)); dy=la-lat; return math.hypot(dx,dy)
    pts.sort(key=dist)
    near=pts[:min(40,len(pts))]
    weights=[1/(dist(p)+0.00015)**2 for p in near]
    elev=sum(w*p[2] for w,p in zip(weights,near))/sum(weights)
    # least-squares plane z = a*x+b*y+c in km; slope = atan(sqrt(a^2+b^2))
    if len(near)>=3:
        sx=sy=sxx=syy=sxy=sz=sxz=syz=0.0
        for p,w in zip(near,weights):
            x=(p[1]-lon)*111.32*math.cos(math.radians(lat)); y=(p[0]-lat)*111.32; z=p[2]
            sx+=w*x; sy+=w*y; sxx+=w*x*x; syy+=w*y*y; sxy+=w*x*y; sz+=w*z; sxz+=w*x*z; syz+=w*y*z
        A=[[sxx,sxy,sx],[sxy,syy,sy],[sx,sy,sum(weights)]]; B=[sxz,syz,sz]
        try:
            # Gaussian elimination 3x3
            for i in range(3):
                piv=max(range(i,3),key=lambda j:abs(A[j][i])); A[i],A[piv]=A[piv],A[i]; B[i],B[piv]=B[piv],B[i]
                for j in range(i+1,3):
                    f=A[j][i]/A[i][i]
                    for k in range(i,3): A[j][k]-=f*A[i][k]
                    B[j]-=f*B[i]
            c=[0,0,0]
            for i in range(2,-1,-1): c[i]=(B[i]-sum(A[i][j]*c[j] for j in range(i+1,3)))/A[i][i]
            slope=math.degrees(math.atan(math.hypot(c[0],c[1])))
        except Exception: slope=None
    else: slope=None
    return {'status':'OK','source':'NASA GDS / LRO LOLA RDR','elevation_m':round(elev,1),'slope_deg':None if slope is None else round(slope,2),
            'sample_count':len(pts),'nearest_m':round(dist(near[0])*111320,1),'product_url':topo_url}


def diviner(lat, lon):
    west=normalize_lon(lon-0.035); east=normalize_lon(lon+0.035)
    if east < west: west=max(0,west); east=min(360,east)
    # Channels 3-9 are requested for thermal measurements; the service requires a 9-character mask.
    params={'query':'divinerrdr','results':'a','channel':'fftffffff','westernlon':f'{west:.5f}','easternlon':f'{east:.5f}',
            'minlat':f'{max(-90,lat-0.035):.5f}','maxlat':f'{min(90,lat+0.035):.5f}'}
    text=gds(params,60); files=get_result_files(text)
    csv_url=next((u for u in files if u.lower().endswith('.csv') or 'ascii' in u.lower()),None)
    if not csv_url: return {'status':'NO_DATA','source':'NASA GDS / Diviner RDR','raw_summary':text[:500]}
    rows=csv_rows(csv_url)
    temps=[]; inc=[]; az=[]; ltimes=[]
    for r in rows:
        # Diviner releases have changed column naming across products; use flexible matching.
        t=None
        for key,val in r.items():
            if 'tb' in key.lower() or 'brightness' in key.lower():
                try:
                    x=float(val); 
                    if 10<=x<=450: temps.append(x); t=x
                except: pass
        x=num(r,'Sol_INC','Solar_Incidence','Solar_Incidence_Angle');
        if x is not None and 0<=x<=180: inc.append(x)
        x=num(r,'Sol_Az','Solar_Azimuth','Solar_Azimuth_Angle');
        if x is not None and 0<=x<=360: az.append(x)
        for key,val in r.items():
            if 'local' in key.lower() and 'time' in key.lower():
                try:
                    x=float(val); 
                    if 0<=x<=24: ltimes.append(x)
                except: pass
    # Thermal values are brightness temperatures, not a single universal surface temperature.
    temp=sum(temps)/len(temps) if temps else None
    return {'status':'OK' if (temp is not None or inc or az) else 'NO_DATA','source':'NASA GDS / LRO Diviner RDR',
            'brightness_temp_K':None if temp is None else round(temp,2),
            'solar_incidence_deg':None if not inc else round(sum(inc)/len(inc),2),
            'solar_azimuth_deg':None if not az else round(sum(az)/len(az),2),
            'local_time_hours':None if not ltimes else round(sum(ltimes)/len(ltimes),2),
            'sample_count':len(rows),'product_url':csv_url}


def site(lat,lon):
    key=(round(lat,3),round(lon,3))
    with LOCK:
        if key in CACHE and time.time()-CACHE[key]['ts']<900: return CACHE[key]['data']
    result={'lat':lat,'lon':lon,'generated_at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),
            'atmospheric_wind':None,'atmosphere_note':'Moon has no substantial atmosphere; atmospheric wind is not applicable.',
            'data_status':'NASA LIVE QUERY'}
    try: result['lola']=lola(lat,lon)
    except Exception as e: result['lola']={'status':'ERROR','error':str(e),'source':'NASA GDS / LRO LOLA RDR'}
    try: result['diviner']=diviner(lat,lon)
    except Exception as e: result['diviner']={'status':'ERROR','error':str(e),'source':'NASA GDS / LRO Diviner RDR'}
    with LOCK: CACHE[key]={'ts':time.time(),'data':result}
    return result


class Handler(SimpleHTTPRequestHandler):
    def translate_path(self,path):
        # Serve the prototype directory regardless of current working directory.
        path=path.split('?',1)[0]
        rel=os.path.normpath(path.lstrip('/'))
        return os.path.join(ROOT,rel)
    def do_GET(self):
        p=urlparse(self.path)
        if p.path=='/api/site':
            try:
                q=parse_qs(p.query); lat=float(q.get('lat',['0'])[0]); lon=float(q.get('lon',['0'])[0])
                if not (-90<=lat<=90 and -180<=lon<=180): raise ValueError('Latitude/longitude out of range')
                data=site(lat,lon)
                body=json.dumps(data).encode()
                self.send_response(200); self.send_header('Content-Type','application/json'); self.send_header('Access-Control-Allow-Origin','*'); self.end_headers(); self.wfile.write(body)
            except Exception as e:
                body=json.dumps({'status':'ERROR','error':str(e)}).encode(); self.send_response(500); self.send_header('Content-Type','application/json'); self.end_headers(); self.wfile.write(body)
            return
        if p.path=='/api/health':
            body=json.dumps({'status':'ok','nasa_gds':'configured','message':'Backend ready to query NASA PDS Geosciences GDS.'}).encode()
            self.send_response(200); self.send_header('Content-Type','application/json'); self.end_headers(); self.wfile.write(body); return
        return super().do_GET()

if __name__=='__main__':
    os.chdir(ROOT)
    print(f'Lunar Landing Analyzer V6 running on port {PORT}')
    print('NASA source: PDS Geosciences Node GDS / LRO LOLA + Diviner')
    ThreadingHTTPServer((HOST,PORT),Handler).serve_forever()
