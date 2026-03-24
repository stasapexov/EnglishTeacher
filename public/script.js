function check(){

    let answer = document.getElementById("answer").value

    if(answer.toLowerCase()=="apple"){

        document.getElementById("result").innerText="Correct!"

    }else{

        document.getElementById("result").innerText="Wrong"

    }

}