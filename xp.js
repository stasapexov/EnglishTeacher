let xp = localStorage.getItem("xp") || 0

let level = Math.floor(xp/100)+1

document.getElementById("xp").innerText=xp
document.getElementById("level").innerText=level

function addXP(points){

    xp = Number(xp) + points

    localStorage.setItem("xp",xp)

}