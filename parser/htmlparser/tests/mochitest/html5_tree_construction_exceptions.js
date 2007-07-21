/* these are the tests we don't pass */
var html5Exceptions = {
"<b><table><td><i></table>": true,
  "<b><table><td></b><i></table>X": true,
  "<p><b><div><marquee></p></b></div>X": true,
  "<!--><div>--<!-->": true,
  "<p><hr></p>": true,
  "<select><b><option><select><option></b></select>X": true,
  "<a><table><td><a><table></table><a></tr><a></table><b>X</b>C<a>Y": true,
  "<!-----><font><div>hello<table>excite!<b>me!<th><i>please!</tr><!--X-->": true,
  "<!DOCTYPE HTML><li>hello<li>world<ul>how<li>do</ul>you</body><!--do-->": true,
  "<!DOCTYPE HTML>A<option>B<optgroup>C<select>D</option>E": true,
  "</#": true,
  "<?": true,
  "<?#": true,
  "<!": true,
  "<!#": true,
  "<?COMMENT?>": true,
  "<!COMMENT>": true,
  "</ COMMENT >": true,
  "<?COM--MENT?>": true,
  "<!COM--MENT>": true,
  "</ COM--MENT >": true,
  "<p id=a><b><p id=b></b>TEST": true,
  "<b id=a><p><b id=b></p></b>TEST": true,
  "<b>A<cite>B<div>C": true,
  "<b>A<cite>B<div>C</cite>D": true,
  "<cite><b><cite><i><cite><i><cite><i><div>X</b>TEST": true,
  "<DIV> abc <B> def <I> ghi <P>": true,
  "<DIV> abc <B> def <I> ghi <P> jkl": true,
  "<DIV> abc <B> def <I> ghi <P> jkl </B>": true,
  "<DIV> abc <B> def <I> ghi <P> jkl </B> mno": true,
  "<DIV> abc <B> def <I> ghi <P> jkl </B> mno </I>": true,
  "<DIV> abc <B> def <I> ghi <P> jkl </B> mno </I> pqr": true,
  "<DIV> abc <B> def <I> ghi <P> jkl </B> mno </I> pqr </P>": true,
  "<DIV> abc <B> def <I> ghi <P> jkl </B> mno </I> pqr </P> stu": true,
  "<a href=\"blah\">aba<table><a href=\"foo\">br<tr><td></td></tr>x</table>aoe": true,
  "<a href=\"blah\">aba<table><tr><td><a href=\"foo\">br</td></tr>x</table>aoe": true,
  "<table><a href=\"blah\">aba<tr><td><a href=\"foo\">br</td></tr>x</table>aoe": true,
  "<a href=a>aa<marquee>aa<a href=b>bb</marquee>aa": true,
  "<a><table><a></table><p><a><div><a>": true,
  "<head></p><meta><p>": true,
  "<b><table><td></b><i></table>": true,
  "<a><p><a></a></p></a>": true,
  "<p><b><div><marquee></p></b></div>": true,
  "<select><b><option><select><option></b></select>": true,
  "<a><table><td><a><table></table><a></tr><a></table><a>": true,
  "<ul><li></li><div><li></div><li><li><div><li><address><li><b><em></b><li></ul>": true,
  "<table><col><tbody><col><tr><col><td><col></table><col>": true,
  "</strong></b></em></i></u></strike></s></blink></tt></pre></big></small></font></select></h1></h2></h3></h4></h5></h6></body></br></a></img></title></span></style></script></table></th></td></tr></frame></area></link></param></hr></input></col></base></meta></basefont></bgsound></embed></spacer></p></dd></dt></caption></colgroup></tbody></tfoot></thead></address></blockquote></center></dir></div></dl></fieldset></listing></menu></ol></ul></li></nobr></wbr></form></button></marquee></object></html></frameset></head></iframe></image></isindex></noembed></noframes></noscript></optgroup></option></plaintext></textarea>": true,
  "<table><tr></strong></b></em></i></u></strike></s></blink></tt></pre></big></small></font></select></h1></h2></h3></h4></h5></h6></body></br></a></img></title></span></style></script></table></th></td></tr></frame></area></link></param></hr></input></col></base></meta></basefont></bgsound></embed></spacer></p></dd></dt></caption></colgroup></tbody></tfoot></thead></address></blockquote></center></dir></div></dl></fieldset></listing></menu></ol></ul></li></nobr></wbr></form></button></marquee></object></html></frameset></head></iframe></image></isindex></noembed></noframes></noscript></optgroup></option></plaintext></textarea>": true,
  "<!DOCTYPE htmL><dt><div><dd>": true,
  "<!doctypehtml><scrIPt type=text/x-foobar;baz>X</SCRipt": true,
  "&#X": true,
  "&#x": true,
  "<!doctype html><p><b><i><u></p> <p>X": true,
  "<!doctype html><!-- X": true,
  "<!doctype html><select><optgroup><option></optgroup><option><select><option>": true,
  "<!DoctypE html><!-- XXX - XXX -->": true,
  "<!DoctypE html><!-- XXX - XXX": true,
  "<!DoctypE html><!-- XXX - XXX - XXX -->": true,
  "<isindex test=x name=x>": true,
  " \n ": true,
  "<!doctype html>  <html>": true,
  "<!doctype html><!--x--": true,
  "<head></head><!-- --><style></style><!-- --><script></script>": true,
  "<head></head><!-- -->x<style></style><!-- --><script></script>": true,
  "<body><body><base><link><meta><title><p></title><body><p></body>": true,
  "<!doctype html><body><title>X</title><meta name=z><link rel=foo><style>\nx { content:\"</style\" } </style>": true,
}

