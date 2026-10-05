import json, math
from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor, Color, white
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

D=Path(__file__).parent
r=json.loads((D/'result.json').read_text())
pdfmetrics.registerFont(TTFont('Sans','/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'))
pdfmetrics.registerFont(TTFont('Bold','/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'))
W,H=842,595
c=canvas.Canvas(str(D/'October-allocation.pdf'),pagesize=(W,H))
c.setTitle('October allocation | Octubre 2026')
navy='#142D43'; muted='#52677A'; teal='#147D86'
def text(x,y,s,size=11,color=navy,font='Sans'):
    c.setFillColor(HexColor(color));c.setFont(font,size);c.drawString(x,y,str(s))
def rect(x,y,w,h,color):
    c.setFillColor(HexColor(color));c.rect(x,y,w,h,fill=1,stroke=0)
def page(n,title,sub):
    rect(0,0,W,H,'#FFFFFF')
    text(38,557,'OCTOBER ALLOCATION',11,teal,'Bold')
    text(38,518,title,27,font='Bold');text(38,492,sub,11,muted)
    rect(38,35,766,1,'#DCE4E9')
    text(38,20,'Octubre 2026  •  Datos al 02.10.2026  •  Yahoo Finance, precios ajustados',8,muted)
    text(765,20,f'{n} / 4',8,muted)
def pct(v,d=2):return f'{100*v:.{d}f}%'.replace('.',',')
e={x['ticker']:x for x in r['factorEvidence']}
names=r['selected']
factors=[x for x in e[names[0]]['contributions'] if x['available'] and x['effectiveWeight']>0]
labels=['Momentum','Tendencia','Baja vol.','Drawdown','Reversión','Diversific.']
def vals(t,field):
    by={x['factorId']:x for x in e[t]['contributions']}
    return [by[f['factorId']][field] for f in factors]
for t in names:
    assert abs(sum(vals(t,'weightedContribution'))-e[t]['score'])<1e-8
assert abs(sum(r['weights'].values())-.5)<1e-10
page(1,'La asignación de octubre','Selección multifactor clásica + mínima varianza condicionada al subconjunto')
for x,big,small in [(38,'50%','Equity'),(230,'50%','Cash'),(422,'12','Posiciones'),(614,'4,34%','Volatilidad anual estimada')]:
    rect(x,395,180,68,'#F0F5F7');text(x+14,429,big,25,font='Bold');text(x+14,409,small,10,muted)
text(38,365,'Distribución del patrimonio',15,font='Bold')
colors=['#BBC7D0','#147D86','#6D8DB8','#9EAF6D','#E4AD63']
parts=[('Cash',.5),('EE. UU.',.375),('Europa',.075),('Canadá',.025),('Japón',.025)]
start=90
for (label,value),color in zip(parts,colors):
    c.setFillColor(HexColor(color));c.wedge(48,104,278,334,start,360*value,stroke=0,fill=1);start+=360*value
for i,((label,value),color) in enumerate(zip(parts,colors)):
    y=309-35*i;rect(303,y-2,12,12,color);text(326,y,f'{label}  {pct(value,1)}',12)
text(505,354,'Cómo se construye',15,font='Bold')
for i,(title,lines) in enumerate([
 ('01  Selección',['20 candidatos equity evaluados.','Los 12 mejores scores integran la cartera.']),
 ('02  Asignación',['Mínima varianza sobre los seleccionados.','252 retornos; contracción diagonal del 20%.']),
 ('03  Mandato',['50% equity y 50% cash.','Entre 2,5% y 10% por ETF seleccionado.'])]):
    y=315-i*83;text(505,y,title,12,teal,'Bold')
    for j,s in enumerate(lines):text(505,y-21-j*17,s,10)
c.showPage()
page(2,'Posiciones y exposición','Pesos sobre el patrimonio total; el score se utiliza para seleccionar, no para repartir el capital.')
market={'XLP':'Consumo básico · EE. UU.','XLE':'Energía · EE. UU.','XLV':'Salud · EE. UU.','XLF':'Finanzas · EE. UU.','XLRE':'Inmobiliario · EE. UU.','XLK':'Tecnología · EE. UU.','IWM':'Small caps · EE. UU.','EWC':'Canadá','EWU':'Reino Unido','EWG':'Alemania','EWJ':'Japón','EUFN':'Finanzas · Europa'}
rect(38,447,766,27,navy)
for x,s in [(50,'ETF'),(118,'Exposición'),(382,'Peso'),(487,'Score / 100'),(615,'Peso relativo')]:text(x,455,s,10,'#FFFFFF','Bold')
for i,t in enumerate(sorted(names,key=lambda t:-r['weights'][t])):
    y=423-i*25
    if i%2==0:rect(38,y-6,766,25,'#F1F5F7')
    text(50,y,t,11,font='Bold');text(118,y,market[t],11)
    text(382,y,pct(r['weights'][t],4),11);text(487,y,f"{e[t]['score']:.2f}".replace('.',','),11)
    rect(615,y-1,r['weights'][t]/.1*167,9,teal)
text(50,100,'CASH',11,font='Bold');text(382,100,'50,0000%',11,font='Bold')
text(50,72,'TOTAL  100%     |     12 ETFs     |     Mínimo 2,5%     |     Máximo 10%',12,teal,'Bold')
c.showPage()
page(3,'Heatmap de factores','Scores normalizados de 0 a 100: un valor mayor representa una señal más favorable en ese factor.')
text(38,460,'Ranking completo de los 20 candidatos · fondo azul en el ticker = seleccionado',10,muted)
xs=[145+i*84 for i in range(6)]
for x,l in zip(xs,labels):text(x+4,435,l,10,font='Bold')
text(666,435,'Score',10,font='Bold');text(738,435,'Peso',10,font='Bold')
for i,item in enumerate(r['ranking']):
    t=item['ticker'];y=412-i*17
    if t in names:rect(38,y-3,84,16,'#DCEEEF')
    text(48,y,t,9,font='Bold')
    for x,v in zip(xs,vals(t,'normalizedValue')):
        a=v/100
        c.setFillColor(Color((239-201*a)/255,(245-131*a)/255,(247-81*a)/255));c.rect(x,y-3,80,16,stroke=0,fill=1)
        text(x+29,y,f'{v:.0f}',9,'#FFFFFF' if v>65 else navy)
    text(666,y,f"{item['score']:.2f}",9,font='Bold')
    text(738,y,pct(r['weights'][t]),9)
text(38,51,'Umbral de elegibilidad: 0  •  20 elegibles  •  Se retienen los 12 scores más altos',10,teal)
c.showPage()
page(4,'Atribución factorial del score','Cada celda muestra los puntos aportados por el factor al score total de selección.')
for x,l in zip(xs,labels):text(x+4,450,l,10,font='Bold')
text(666,450,'Total',10,font='Bold')
for i,t in enumerate(names):
    y=425-i*22;text(48,y,t,10,font='Bold')
    for x,v in zip(xs,vals(t,'weightedContribution')):
        a=min(v/27,1);c.setFillColor(Color((239-201*a)/255,(245-131*a)/255,(247-81*a)/255));c.rect(x,y-4,80,21,stroke=0,fill=1)
        text(x+24,y,f'{v:.2f}',10,'#FFFFFF' if a>.65 else navy)
    text(666,y,f"{e[t]['score']:.2f}",10,font='Bold')
text(38,137,'Peso efectivo en el score',12,font='Bold')
for i,(lab,f) in enumerate(zip(labels,factors)):
    x=38+i*128;text(x,113,lab,10,muted);text(x,91,pct(f['effectiveWeight']),15,teal,'Bold')
text(38,65,'Contribución = score del factor × peso efectivo. Se muestran los seis factores utilizados.',10,muted)
text(38,49,'La atribución explica la selección; los pesos de cartera se determinan minimizando la varianza.',10,muted)
c.save()
print(D/'October-allocation.pdf')
