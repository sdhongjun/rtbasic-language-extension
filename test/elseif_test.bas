' 测试ElseIf语句的解析

Sub TestIfElseIf(x)
  ' 多行If-ElseIf-Else结构
  If x > 10 Then
    Print "x is greater than 10"
  ElseIf x > 5 Then
    Print "x is greater than 5 but not greater than 10"
  Else
    Print "x is not greater than 5"
  End If
  
  ' 单行ElseIf语句
  If x = 1 Then Print "x is 1"
  ElseIf x = 2 Then Print "x is 2"
  ElseIf x = 3 Then Print "x is 3"
  Else Print "x is not 1, 2, or 3"
  
  ' 混合使用
  If x < 0 Then
    Print "x is negative"
  ElseIf x = 0 Then Print "x is zero"
  Else
    Print "x is positive"
  End If
End Sub