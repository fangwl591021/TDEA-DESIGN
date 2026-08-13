from pathlib import Path
p=Path('public/app-20260803-123.js')
s=p.read_text(encoding='utf-8')
old='document.querySelectorAll("[data-calendar-date]").forEach((button)=>button.onclick=()=>{state.calendarSelectedDate=button.dataset.calendarDate||"";renderPersonalCalendarView();});'
new='document.querySelectorAll("[data-calendar-date]").forEach((button)=>button.onclick=()=>{state.calendarSelectedDate=button.dataset.calendarDate||"";renderPersonalCalendarView();requestAnimationFrame(()=>document.querySelector(".personal-calendar-agenda")?.scrollIntoView({behavior:"smooth",block:"start"}));});'
if old not in s: raise SystemExit('calendar date click anchor not found')
s=s.replace(old,new,1)
p.write_text(s,encoding='utf-8')
