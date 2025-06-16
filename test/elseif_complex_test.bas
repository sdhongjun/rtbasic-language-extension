' 复杂的ElseIf语句测试

Sub TestComplexIfElseIf(x, y, z)
  ' 测试1: 嵌套的If-ElseIf-Else结构
  If x > 10 Then
    Print "x is greater than 10"
    If y > 5 Then
      Print "y is also greater than 5"
    ElseIf y > 0 Then
      Print "y is positive but not greater than 5"
    Else
      Print "y is not positive"
    End If
  ElseIf x > 5 Then
    Print "x is greater than 5 but not greater than 10"
  Else
    Print "x is not greater than 5"
  End If
  
  ' 测试2: 连续的单行ElseIf语句
  If x = 1 Then Print "x is 1"
  ElseIf x = 2 Then Print "x is 2"
  ElseIf x = 3 Then Print "x is 3"
  Else Print "x is not 1, 2, or 3"
  
  ' 测试3: 混合使用单行和多行ElseIf
  If x < 0 Then
    Print "x is negative"
  ElseIf x = 0 Then Print "x is zero"
  ElseIf x > 0 And x < 10 Then
    Print "x is between 0 and 10"
  Else
    Print "x is 10 or greater"
  End If
  
  ' 测试4: 复杂条件的单行ElseIf
  If x > 100 And y > 100 Then Print "Both x and y are large"
  ElseIf (x > 50 And y > 50) Or z > 100 Then Print "Either both x and y are medium, or z is large"
  ElseIf x + y + z > 200 Then Print "Sum is large"
  Else Print "None of the conditions met"
End Sub