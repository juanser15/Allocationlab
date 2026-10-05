import json, math
from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.colors import HexColor, Color
D=Path(__file__).parent
r=json.loads((D/'result.json').read_text())
for name,file in [('S','DejaVuSans.ttf'),('B','DejaVuSans-Bold.ttf')]:
    pdfmetrics.registerFont(TTFont(name,'/usr/share/fonts/truetype/dejavu/'+file))
c=canvas.Canvas(str(D/'October-allocation-English.pdf'),pagesize=(1190,842))
c.setTitle('Portfolio - October 2026')
navy='#0B274A';gray='#67727E'
def t(x,y,s,size=11,b=False,col=navy):
    c.setFillColor(HexColor(col));c.setFont('B' if b else 'S',size);c.drawString(x,y,str(s))
def box(x,y,w,h,col):
    c.setFillColor(HexColor(col));c.rect(x,y,w,h,stroke=0,fill=1)
def line(y):
    box(42,y,1106,1,'#CBD4DD')
def header(n,title):
    t(42,807,'Cash: 50%  |  Max per ETF: 10%  |  Minimum selected position: 2.5%',10,col=gray)
    t(42,771,title,27,True)
    t(42,749,'Classical multifactor selection + subset-conditioned minimum variance',12,col=gray)
    line(733)
    line(39);t(42,23,'Data: October 2, 2026  |  Yahoo Finance adjusted prices  |  October allocation',9,col=gray)
    t(1100,23,f'{n} / 2',9,col=gray)
e={a['ticker']:a for a in r['factorEvidence']}
names=sorted(r['selected'],key=lambda x:-r['weights'][x])
fs=[f for f in e[names[0]]['contributions'] if f['available'] and f['effectiveWeight']>0]
labels=['Momentum','Trend','Low vol.','Drawdown','Reversal','Diversif.']
def values(ticker,field):
    m={x['factorId']:x for x in e[ticker]['contributions']}
    return [m[f['factorId']][field] for f in fs]
def heat(x,y,tickers,field,width=75,row=23):
    heads=['ETF']+labels+['Score']
    for j,h in enumerate(heads):
        box(x+j*width,y,width,23,navy);t(x+j*width+5,y+8,h,9,True,'#FFFFFF')
    for i,ticker in enumerate(tickers):
        yy=y-(i+1)*row
        box(x,yy,width,row,'#F0F4F7');t(x+7,yy+7,ticker,10,True)
        for j,v in enumerate(values(ticker,field)):
            a=min(1,v/(100 if field=='normalizedValue' else 27))
            lo=(226,114,87);mid=(251,233,151);hi=(75,168,123)
            p,q,z=(lo,mid,a*2) if a<.5 else (mid,hi,(a-.5)*2)
            c.setFillColor(Color(*[(p[k]+(q[k]-p[k])*z)/255 for k in range(3)]))
            c.rect(x+(j+1)*width,yy,width,row,stroke=0,fill=1)
            t(x+(j+1)*width+20,yy+7,f'{v:.0f}' if field=='normalizedValue' else f'{v:.2f}',9)
        box(x+7*width,yy,width,row,'#EFF3F6')
        t(x+7*width+12,yy+7,f"{e[ticker]['score']:.2f}",10,True)
header(1,'PORTFOLIO - OCTOBER 2026')
box(908,751,110,62,'#F2F5F8');t(920,795,'REGIME',9,True);t(920,776,'NEUTRAL',12,True);t(920,760,'42.4 / 100',10)
box(1026,751,122,62,navy);t(1061,795,'CASH',10,True,'#FFFFFF');t(1049,764,'50%',28,True,'#FFFFFF')
t(42,708,'PORTFOLIO ALLOCATION',14,True)
t(42,689,'Equity sleeve: 50%  |  Cash: 50%',11,col=gray)
colors=['#0B274A','#245F9C','#528BC1','#1C8D92','#7C6AAA','#D69A3E','#B44848','#538068','#93AC70','#7F94B0','#BD767F','#65798C']
cx,cy,rad=242,502,158
angle=90
for ticker,col in zip(names,colors):
    extent=360*r['weights'][ticker]/.5
    c.setFillColor(HexColor(col));c.wedge(cx-rad,cy-rad,cx+rad,cy+rad,angle,extent,stroke=0,fill=1)
    angle+=extent
c.setFillColor(HexColor('#FFFFFF'));c.circle(cx,cy,103,stroke=0,fill=1)
t(cx-48,cy,'50%',34,True);t(cx-40,cy-24,'Invested',13)
box(42,182,415,139,'#F5F7FA');t(54,302,'October portfolio weights',12,True)
for i,(ticker,col) in enumerate(zip(names,colors)):
    xx=54+(i%3)*133;yy=278-(i//3)*25
    box(xx,yy,7,7,col);t(xx+13,yy,f'{ticker}  {r["weights"][ticker]*100:.2f}%',10)
t(492,708,'FACTOR DECOMPOSITION',14,True)
t(492,689,'Scores 0–100; greener cells indicate a stronger factor signal.',10,col=gray)
heat(492,655,r['selected'],'normalizedValue',82,22)
t(492,347,'INVESTMENT SNAPSHOT',14,True)
metrics=[('Active ETFs','12'),('Equity / cash','50% / 50%'),('United States','37.5%'),('Europe / Canada / Japan','7.5% / 2.5% / 2.5%'),('Estimated annual volatility','4.34%')]
for i,(a,b) in enumerate(metrics):
    yy=316-i*27;box(492,yy-6,656,26,'#F3F6F8' if i%2==0 else '#FFFFFF');t(504,yy,a,11);t(938,yy,b,11,True)
t(42,149,'KEY DRIVERS',14,True)
for i,s in enumerate([
 'Health Care leads the selection ranking (80.89); Canada follows at 75.35.',
 'Consumer Staples has the largest allocation at 10%; Energy follows at 8.87%.',
 'Six US sector ETFs and US small caps account for 37.5% of total portfolio value.',
 'Scores select the holdings; minimum variance determines their final weights.']):
    t(42,125-i*20,f'{i+1}.  {s}',11)
c.showPage()
header(2,'FACTOR ATTRIBUTION & UNIVERSE')
t(42,703,'FACTOR CONTRIBUTIONS TO SELECTION SCORE',14,True)
t(42,682,'Each contribution equals the normalized factor score multiplied by its effective weight.',11,col=gray)
heat(42,642,r['selected'],'weightedContribution',88,25)
t(783,648,'EFFECTIVE FACTOR WEIGHTS',13,True)
for i,(label,f) in enumerate(zip(labels,fs)):
    yy=611-i*42;t(783,yy,label,12);t(1037,yy,f'{f["effectiveWeight"]*100:.2f}%',12,True)
    box(783,yy-12,330*f['effectiveWeight']/.27,5,'#245F9C')
t(42,302,'FULL CANDIDATE RANKING',14,True)
for j in range(2):
    xx=42+j*560
    box(xx,266,540,23,navy)
    for dx,s in [(10,'Rank'),(70,'ETF'),(170,'Score'),(290,'Portfolio weight'),(435,'Selected')]:t(xx+dx,274,s,10,True,'#FFFFFF')
    for i,it in enumerate(r['ranking'][j*10:(j+1)*10]):
        yy=245-i*19;ticker=it['ticker']
        if i%2==0:box(xx,yy-4,540,19,'#F2F5F8')
        for dx,s in [(10,j*10+i+1),(70,ticker),(170,f'{it["score"]:.2f}'),(290,f'{r["weights"][ticker]*100:.4f}%'),(435,'Yes' if ticker in names else 'No')]:
            t(xx+dx,yy,s,10,b=dx==70)
c.save()
print(D/'October-allocation-English.pdf')
