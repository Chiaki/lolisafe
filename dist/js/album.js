var lsKeys={},page={lazyLoad:null};window.onload=function(){for(var e=document.querySelectorAll(".file-size"),a=0;a<e.length;a++)e[a].innerHTML=page.getPrettyBytes(parseInt(e[a].innerHTML.replace(/\s*B$/i,"")));page.lazyLoad=new LazyLoad};
//# sourceMappingURL=album.js.map
